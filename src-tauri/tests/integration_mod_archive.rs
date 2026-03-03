use std::io::Write;
use traybuddy_lib::modules::mod_archive::{ModArchiveReader, ZipArchiveReader};
use zip::write::FileOptions;

fn build_zip(entries: Vec<(&str, &str)>) -> Vec<u8> {
    let cursor = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let options = FileOptions::<()>::default();

    for (path, content) in entries {
        if path.ends_with('/') {
            zip.add_directory(path, options).unwrap();
        } else {
            zip.start_file(path, options).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
    }

    zip.finish().unwrap().into_inner()
}

#[test]
fn zip_archive_reader_reads_and_lists() {
    let data = build_zip(vec![
        ("root/", ""),
        ("root/dir/", ""),
        ("root/dir/file.txt", "hello"),
        ("root/file.txt", "world"),
    ]);

    let reader = ZipArchiveReader::from_bytes(data).unwrap();
    assert_eq!(reader.root_folder_name(), "root");
    assert!(reader.file_exists("dir/file.txt"));

    let content = reader.read_file("dir/file.txt").unwrap();
    assert_eq!(String::from_utf8_lossy(&content), "hello");

    let entries = reader.list_dir("");
    let names: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
    assert!(names.contains(&"dir".to_string()));
    assert!(names.contains(&"file.txt".to_string()));
}

#[test]
fn zip_reader_case_insensitive_read_file() {
    // ZIP 中用大写路径 "Root/Dir/FILE.TXT"，但通过小写 "dir/file.txt" 访问
    // 这触发 read_file 的大小写不敏感遍历查找分支
    let data = build_zip(vec![
        ("Root/", ""),
        ("Root/Dir/", ""),
        ("Root/Dir/FILE.TXT", "case test"),
    ]);

    let reader = ZipArchiveReader::from_bytes(data).unwrap();
    assert_eq!(reader.root_folder_name(), "Root");

    // 精确匹配成功
    let content = reader.read_file("Dir/FILE.TXT").unwrap();
    assert_eq!(String::from_utf8_lossy(&content), "case test");

    // 使用不同大小写：精确匹配失败 -> 备选路径失败 -> 遍历查找成功
    let content = reader.read_file("dir/file.txt").unwrap();
    assert_eq!(String::from_utf8_lossy(&content), "case test");
}

#[test]
fn zip_reader_file_not_found() {
    let data = build_zip(vec![
        ("root/", ""),
        ("root/file.txt", "hello"),
    ]);

    let reader = ZipArchiveReader::from_bytes(data).unwrap();
    let result = reader.read_file("nonexistent.txt");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("File not found"));
}

#[test]
fn zip_reader_file_exists_case_insensitive() {
    let data = build_zip(vec![
        ("Root/", ""),
        ("Root/Data.JSON", "{}"),
    ]);

    let reader = ZipArchiveReader::from_bytes(data).unwrap();
    // 精确匹配
    assert!(reader.file_exists("Data.JSON"));
    // 大小写不敏感
    assert!(reader.file_exists("data.json"));
    // 不存在
    assert!(!reader.file_exists("missing.txt"));
}

#[test]
fn zip_reader_list_dir_subdirectory() {
    let data = build_zip(vec![
        ("mod/", ""),
        ("mod/asset/", ""),
        ("mod/asset/img/", ""),
        ("mod/asset/img/a.png", "png"),
        ("mod/asset/sound.wav", "wav"),
        ("mod/manifest.json", "{}"),
    ]);

    let reader = ZipArchiveReader::from_bytes(data).unwrap();

    // list root
    let entries = reader.list_dir("");
    let names: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
    assert!(names.contains(&"asset".to_string()));
    assert!(names.contains(&"manifest.json".to_string()));

    // list subdirectory
    let entries = reader.list_dir("asset");
    let names: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
    assert!(names.contains(&"img".to_string()));
    assert!(names.contains(&"sound.wav".to_string()));
}
