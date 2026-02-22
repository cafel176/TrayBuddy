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
