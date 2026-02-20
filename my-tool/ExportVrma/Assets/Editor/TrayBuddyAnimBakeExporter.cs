// TrayBuddyAnimBakeExporter.cs
// Unity Editor tool: Bake a Humanoid (.anim) clip to Transform curves, then optionally export.
//
// Place under: <UnityProject>/Assets/Editor/TrayBuddyAnimBakeExporter.cs
//
// Batchmode entry:
// Unity.exe -batchmode -quit -projectPath <project> -executeMethod TrayBuddy.AnimConverter.CLI.Run \
//   -model <AssetPath> | -modelFile <AbsPath> \
//   -anim  <AssetPath> | -animFile  <AbsPath> \
//   -outDir Assets/AnimBaked -fps 60 \
//   -exportFbx 0 -exportGltf 0 -exportVrma 0 -exportOutDir AnimExports
//
// IMPORTANT:
// - This relies on Unity Editor APIs (AnimationMode + Avatar/Humanoid). It is not usable in a Unity Player build.

#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace TrayBuddy.AnimConverter
{
    public static class AnimBake
    {
        public sealed class BakeResult
        {
            public AnimationClip bakedClip;
            public string bakedClipAssetPath;
            public GameObject instance;
            public string log;
        }

        public static BakeResult BakeHumanoidClipToTransform(AnimationClip sourceClip, GameObject modelPrefabOrRoot, string outDirAssetPath, float sampleRate)
        {
            var res = new BakeResult { log = "" };

            if (sourceClip == null) throw new ArgumentNullException(nameof(sourceClip));
            if (modelPrefabOrRoot == null) throw new ArgumentNullException(nameof(modelPrefabOrRoot));

            if (sampleRate <= 0) sampleRate = 60f;

            outDirAssetPath = NormalizeAssetPath(string.IsNullOrWhiteSpace(outDirAssetPath) ? "Assets/AnimBaked" : outDirAssetPath);
            EnsureAssetFolder(outDirAssetPath);

            // Instantiate
            GameObject root;
            try
            {
                root = PrefabUtility.InstantiatePrefab(modelPrefabOrRoot) as GameObject;
            }
            catch
            {
                root = null;
            }
            if (root == null) root = UnityEngine.Object.Instantiate(modelPrefabOrRoot);

            root.name = modelPrefabOrRoot.name + "_Baking";
            res.instance = root;

            // Ensure Animator
            var animator = root.GetComponentInChildren<Animator>();
            if (animator == null) animator = root.AddComponent<Animator>();

            if (animator.avatar == null || !animator.avatar.isValid || !animator.avatar.isHuman)
            {
                res.log += "[Warn] Animator.avatar missing or not humanoid. Humanoid sampling may fail.\n";
            }

            // Determine transforms to bake: prefer bones referenced by SkinnedMeshRenderer.
            var bakeTargets = CollectLikelyBones(root);
            if (bakeTargets.Count == 0)
                bakeTargets = root.GetComponentsInChildren<Transform>(true).ToList();

            // Precompute paths
            var paths = new Dictionary<Transform, string>();
            foreach (var t in bakeTargets)
                paths[t] = AnimationUtility.CalculateTransformPath(t, root.transform);

            var curves = new Dictionary<(Transform t, string prop), AnimationCurve>();

            var duration = Mathf.Max(0.0001f, sourceClip.length);
            var dt = 1.0f / Mathf.Max(1.0f, sampleRate);
            var keysCount = Mathf.CeilToInt(duration * sampleRate) + 1;

            AnimationMode.StartAnimationMode();
            try
            {
                for (int i = 0; i < keysCount; i++)
                {
                    var time = Mathf.Min(duration, i * dt);

                    AnimationMode.BeginSampling();
                    AnimationMode.SampleAnimationClip(root, sourceClip, time);
                    AnimationMode.EndSampling();

                    foreach (var t in bakeTargets)
                    {
                        var lp = t.localPosition;
                        AddKey(curves, (t, "m_LocalPosition.x"), time, lp.x);
                        AddKey(curves, (t, "m_LocalPosition.y"), time, lp.y);
                        AddKey(curves, (t, "m_LocalPosition.z"), time, lp.z);

                        var q = t.localRotation;
                        AddKey(curves, (t, "m_LocalRotation.x"), time, q.x);
                        AddKey(curves, (t, "m_LocalRotation.y"), time, q.y);
                        AddKey(curves, (t, "m_LocalRotation.z"), time, q.z);
                        AddKey(curves, (t, "m_LocalRotation.w"), time, q.w);

                        var ls = t.localScale;
                        AddKey(curves, (t, "m_LocalScale.x"), time, ls.x);
                        AddKey(curves, (t, "m_LocalScale.y"), time, ls.y);
                        AddKey(curves, (t, "m_LocalScale.z"), time, ls.z);
                    }
                }
            }
            finally
            {
                AnimationMode.StopAnimationMode();
            }

            var baked = new AnimationClip
            {
                name = sourceClip.name + "_Baked",
                frameRate = sampleRate,
                wrapMode = sourceClip.wrapMode,
            };

            foreach (var kv in curves)
            {
                var t = kv.Key.t;
                var prop = kv.Key.prop;
                var curve = kv.Value;
                var binding = EditorCurveBinding.FloatCurve(paths[t], typeof(Transform), prop);
                AnimationUtility.SetEditorCurve(baked, binding, curve);
            }

            var bakedPath = AssetDatabase.GenerateUniqueAssetPath(Path.Combine(outDirAssetPath, baked.name + ".anim").Replace("\\", "/"));
            AssetDatabase.CreateAsset(baked, bakedPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            res.bakedClip = baked;
            res.bakedClipAssetPath = bakedPath;
            res.log += "[OK] Baked clip saved: " + bakedPath + "\n";

            return res;
        }

        private static void AddKey(Dictionary<(Transform t, string prop), AnimationCurve> curves, (Transform t, string prop) k, float time, float value)
        {
            if (!curves.TryGetValue(k, out var c))
            {
                c = new AnimationCurve();
                curves[k] = c;
            }
            c.AddKey(new Keyframe(time, value));
        }

        private static List<Transform> CollectLikelyBones(GameObject root)
        {
            var set = new HashSet<Transform>();
            foreach (var smr in root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (smr == null) continue;
                if (smr.bones != null)
                {
                    foreach (var b in smr.bones)
                        if (b != null) set.Add(b);
                }
                if (smr.rootBone != null) set.Add(smr.rootBone);
            }
            set.Add(root.transform);
            return set.ToList();
        }

        private static string NormalizeAssetPath(string p)
        {
            var s = (p ?? "").Replace("\\", "/");
            if (!s.StartsWith("Assets"))
            {
                if (s.StartsWith("/")) s = s.TrimStart('/');
                s = "Assets/" + s;
            }
            return s;
        }

        private static void EnsureAssetFolder(string assetDir)
        {
            assetDir = NormalizeAssetPath(assetDir);
            if (AssetDatabase.IsValidFolder(assetDir)) return;

            var parts = assetDir.Split('/').Where(x => !string.IsNullOrWhiteSpace(x)).ToArray();
            var cur = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                var next = cur + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(cur, parts[i]);
                cur = next;
            }
        }
    }

    public static class OptionalExporters
    {
        public static bool TryExportFbx(GameObject root, string outFilePath, out string log)
        {
            log = "";
            var t = FindType("UnityEditor.Formats.Fbx.Exporter.ModelExporter");
            if (t == null)
            {
                log = "未检测到 Unity FBX Exporter（Package: com.unity.formats.fbx）。";
                return false;
            }

            var m = t.GetMethods(BindingFlags.Public | BindingFlags.Static)
                .FirstOrDefault(mi => mi.Name == "ExportObject" && mi.GetParameters().Length == 2);
            if (m == null)
            {
                log = "找到了 FBX Exporter，但未找到 ExportObject(string, Object) API（版本不兼容）。";
                return false;
            }

            try
            {
                m.Invoke(null, new object[] { outFilePath, root });
                log = "[OK] FBX exported: " + outFilePath;
                return true;
            }
            catch (Exception e)
            {
                log = "FBX 导出失败：" + (e.InnerException?.Message ?? e.Message);
                return false;
            }
        }

        public static bool TryExportGltf(GameObject root, string outFilePath, out string log)
        {
            log = "";
            var gltfExportType = FindType("GLTFast.Export.GltfExport");
            if (gltfExportType == null)
            {
                log = "未检测到 glTFast Exporter（GLTFast.Export.GltfExport）。请安装 glTFast Exporter 或按你的导出器版本适配。";
                return false;
            }

            try
            {
                var ctor = gltfExportType.GetConstructors().FirstOrDefault(c => c.GetParameters().Length == 0);
                if (ctor == null) { log = "glTFast GltfExport 构造函数不匹配"; return false; }
                var exporter = ctor.Invoke(null);

                var addScene = gltfExportType.GetMethod("AddScene", new[] { typeof(GameObject) }) ?? gltfExportType.GetMethod("AddScene");
                var save = gltfExportType.GetMethod("SaveToFileAndDispose");

                if (addScene == null || save == null)
                {
                    log = "glTFast API 不匹配（版本不兼容）。";
                    return false;
                }

                if (addScene.GetParameters().Length == 1) addScene.Invoke(exporter, new object[] { root });
                else addScene.Invoke(exporter, null);

                var okObj = save.Invoke(exporter, new object[] { outFilePath });
                var ok = okObj is bool b ? b : true;
                log = ok ? "[OK] glTF exported: " + outFilePath : ("glTF 导出返回 false: " + outFilePath);
                return ok;
            }
            catch (Exception e)
            {
                log = "glTF 导出失败：" + (e.InnerException?.Message ?? e.Message);
                return false;
            }
        }

        private static Transform GetParentHumanoidBoneTransform(
            Dictionary<HumanBodyBones, Transform> map,
            HumanBodyBones bone)
        {
            // Hips has no parent in VRM Humanoid spec
            if (bone == HumanBodyBones.Hips) return null;

            UniVRM10.Vrm10HumanoidBones vrmBone;
            try
            {
                vrmBone = UniVRM10.Vrm10HumanoidBoneSpecification.ConvertFromUnityBone(bone);
            }
            catch
            {
                // bone not defined in VRM humanoid spec
                return null;
            }

            while (true)
            {
                if (vrmBone == UniVRM10.Vrm10HumanoidBones.Hips) return null;

                var def = UniVRM10.Vrm10HumanoidBoneSpecification.GetDefine(vrmBone);
                if (!def.ParentBone.HasValue) return null;

                var parentVrm = def.ParentBone.Value;
                var unityParent = UniVRM10.Vrm10HumanoidBoneSpecification.ConvertToUnityBone(parentVrm);
                if (map.TryGetValue(unityParent, out var found) && found != null) return found;

                // climb up until we find an existing parent
                vrmBone = parentVrm;
            }
        }

        public static bool TryExportVrmaFromModel(
            GameObject modelRoot,
            AnimationClip clipToSample,
            string outFilePath,
            float sampleRate,
            out string log)
        {
            log = "";


            if (modelRoot == null) { log = "modelRoot is null"; return false; }
            if (clipToSample == null) { log = "clipToSample is null"; return false; }
            if (string.IsNullOrWhiteSpace(outFilePath)) { log = "outFilePath is empty"; return false; }
            if (sampleRate <= 0) sampleRate = 60f;

            var animator = modelRoot.GetComponentInChildren<Animator>();
            if (animator == null)
            {
                log = "模型上未找到 Animator，无法导出 VRMA（需要 Humanoid Avatar 才能建立骨骼映射）。";
                return false;
            }
            if (animator.avatar == null || !animator.avatar.isValid || !animator.avatar.isHuman)
            {
                log = "Animator.avatar 缺失或不是 Humanoid，无法导出 VRMA。";
                return false;
            }

            // 收集 HumanBodyBones
            var humanMap = new Dictionary<HumanBodyBones, Transform>();
            foreach (HumanBodyBones bone in Enum.GetValues(typeof(HumanBodyBones)))
            {
                if (bone == HumanBodyBones.LastBone) continue;
                var t = animator.GetBoneTransform(bone);
                if (t != null && !humanMap.ContainsKey(bone)) humanMap.Add(bone, t);
            }

            if (!humanMap.TryGetValue(HumanBodyBones.Hips, out var hips) || hips == null)
            {
                log = "模型 Humanoid 未找到 Hips 骨骼，无法导出 VRMA。";
                return false;
            }

            // 临时禁用渲染器，避免 VRMA 导出把网格也打进去（VRMA 通常只需要骨架）
            var renderers = modelRoot.GetComponentsInChildren<Renderer>(true);
            var prevEnabled = new bool[renderers.Length];
            for (int i = 0; i < renderers.Length; i++)
            {
                prevEnabled[i] = renderers[i].enabled;
                renderers[i].enabled = false;
            }

            try
            {
                var data = new UniGLTF.ExportingGltfData();
                using var exporter = new UniVRM10.VrmAnimationExporter(data, new UniGLTF.GltfExportSettings());
                exporter.Prepare(modelRoot);

                exporter.Export((UniVRM10.VrmAnimationExporter vrma) =>
                {
                    // 位置：Hips 的 root motion（以 modelRoot 为基准）
                    vrma.SetPositionBoneAndParent(hips, modelRoot.transform);

                    // 旋转：按 VRM Humanoid 规范的父子骨骼链计算 parent（不要用 Transform.parent，模型里可能有 twist/中间骨）
                    foreach (var kv in humanMap)
                    {
                        var bone = kv.Key;
                        var t = kv.Value;
                        if (t == null) continue;

                        var parent = GetParentHumanoidBoneTransform(humanMap, bone) ?? modelRoot.transform;
                        vrma.AddRotationBoneAndParent(bone, t, parent);
                    }


                    var duration = Mathf.Max(0.0001f, clipToSample.length);
                    var dt = 1.0f / Mathf.Max(1.0f, sampleRate);
                    var frameCount = Mathf.CeilToInt(duration * sampleRate) + 1;

                    AnimationMode.StartAnimationMode();
                    try
                    {
                        for (int i = 0; i < frameCount; i++)
                        {
                            var timeSec = Mathf.Min(duration, i * dt);

                            AnimationMode.BeginSampling();
                            AnimationMode.SampleAnimationClip(modelRoot, clipToSample, timeSec);
                            AnimationMode.EndSampling();

                            vrma.AddFrame(TimeSpan.FromSeconds(timeSec));
                        }
                    }
                    finally
                    {
                        AnimationMode.StopAnimationMode();
                    }
                });

                var bytes = data.ToGlbBytes();
                Directory.CreateDirectory(Path.GetDirectoryName(outFilePath));
                File.WriteAllBytes(outFilePath, bytes);

                log = "[OK] VRMA exported: " + outFilePath;
                return true;
            }
            catch (Exception e)
            {
                log = "VRMA 导出失败：" + (e.InnerException?.Message ?? e.Message);
                return false;
            }
            finally
            {
                // 还原 Renderer.enabled
                for (int i = 0; i < renderers.Length; i++)
                {
                    if (renderers[i] != null) renderers[i].enabled = prevEnabled[i];
                }
            }
        }


        private static Type FindType(string fullName)
        {
            var t = Type.GetType(fullName);
            if (t != null) return t;
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var tt = asm.GetType(fullName, false);
                    if (tt != null) return tt;
                }
                catch { }
            }
            return null;
        }
    }

    public static class CLI
    {
        public static void Run()
        {
            var args = Environment.GetCommandLineArgs();

            var modelAsset = GetArg(args, "-model");

            // allow multiple inputs: -anim A -anim B ... and/or -animFile absA -animFile absB ...
            var animAssets = GetArgs(args, "-anim");
            var animFiles = GetArgs(args, "-animFile");

            var modelFile = GetArg(args, "-modelFile");

            var outDir = GetArg(args, "-outDir") ?? "Assets/AnimBaked";
            var fpsStr = GetArg(args, "-fps") ?? "60";

            float fps = 60f;
            float.TryParse(fpsStr, out fps);

            var exportFbx = (GetArg(args, "-exportFbx") ?? "0") == "1";
            var exportGltf = (GetArg(args, "-exportGltf") ?? "0") == "1";
            var exportVrma = (GetArg(args, "-exportVrma") ?? "0") == "1";
            var exportOutDir = GetArg(args, "-exportOutDir") ?? "AnimExports";

            if (!string.IsNullOrWhiteSpace(modelFile))
            {
                modelAsset = ImportExternalFileAsAsset(modelFile, "Assets/TrayBuddyInputs");
            }

            // import external anim files (if any)
            if (animFiles.Count > 0)
            {
                foreach (var f in animFiles)
                {
                    var a = ImportExternalFileAsAsset(f, "Assets/TrayBuddyInputs");
                    if (!string.IsNullOrWhiteSpace(a)) animAssets.Add(a);
                }
            }

            // backward compatible single -anim
            if (animAssets.Count == 0)
            {
                var singleAnim = GetArg(args, "-anim");
                if (!string.IsNullOrWhiteSpace(singleAnim)) animAssets.Add(singleAnim);
            }

            if (string.IsNullOrWhiteSpace(modelAsset) || animAssets.Count == 0)
            {
                Debug.LogError("[AnimConverter] Missing model/anim. Use -model (AssetPath) or -modelFile (absolute path), and -anim (AssetPath) and/or -animFile (absolute path). ");
                return;
            }

            var modelGo = ResolveModelGameObject(modelAsset);
            if (modelGo == null)
            {
                Debug.LogError("[AnimConverter] Model asset could not be resolved to GameObject: " + modelAsset);
                return;
            }

            var projectRoot = Directory.GetParent(Application.dataPath).FullName;
            var exportDirAbs = Path.Combine(projectRoot, exportOutDir);
            Directory.CreateDirectory(exportDirAbs);

            foreach (var animAsset in animAssets)
            {
                var clip = ResolveAnimationClip(animAsset);
                if (clip == null)
                {
                    Debug.LogError("[AnimConverter] Anim asset could not be resolved to AnimationClip: " + animAsset);
                    continue;
                }

                var bake = AnimBake.BakeHumanoidClipToTransform(clip, modelGo, outDir, fps);
                Debug.Log("[AnimConverter] " + bake.log);

                if (exportFbx)
                {
                    var fbxPath = Path.Combine(exportDirAbs, modelGo.name + "_" + clip.name + ".fbx");
                    if (OptionalExporters.TryExportFbx(bake.instance, fbxPath, out var log)) Debug.Log("[AnimConverter] " + log);
                    else Debug.LogWarning("[AnimConverter] " + log);
                }

                if (exportGltf)
                {
                    var gltfPath = Path.Combine(exportDirAbs, modelGo.name + "_" + clip.name + ".gltf");
                    if (OptionalExporters.TryExportGltf(bake.instance, gltfPath, out var log)) Debug.Log("[AnimConverter] " + log);
                    else Debug.LogWarning("[AnimConverter] " + log);
                }

                if (exportVrma)
                {
                    var vrmaPath = Path.Combine(exportDirAbs, clip.name + ".vrma");
                    // 直接用源 Humanoid clip 采样导出，避免 bakedClip 因“只烘焙了部分骨骼”导致和原动画不一致
                    if (OptionalExporters.TryExportVrmaFromModel(bake.instance, clip, vrmaPath, fps, out var log)) Debug.Log("[AnimConverter] " + log);

                    else Debug.LogWarning("[AnimConverter] " + log);
                }

                if (bake.instance != null) UnityEngine.Object.DestroyImmediate(bake.instance);
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }


        private static string ImportExternalFileAsAsset(string absPath, string assetFolder)
        {
            if (string.IsNullOrWhiteSpace(absPath) || !File.Exists(absPath))
            {
                Debug.LogError("[AnimConverter] File not found: " + absPath);
                return null;
            }

            EnsureFolder(assetFolder);

            var guid = Guid.NewGuid().ToString("N").Substring(0, 8);
            var sub = assetFolder.TrimEnd('/') + "/" + guid;
            EnsureFolder(sub);

            var fileName = Path.GetFileName(absPath);
            var dstAssetPath = sub + "/" + fileName;
            var dstAbs = Path.Combine(Directory.GetParent(Application.dataPath).FullName, dstAssetPath).Replace("/", "\\");

            File.Copy(absPath, dstAbs, true);
            AssetDatabase.ImportAsset(dstAssetPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            return dstAssetPath;
        }

        private static void EnsureFolder(string assetPath)
        {
            assetPath = assetPath.Replace("\\", "/");
            if (!assetPath.StartsWith("Assets")) assetPath = "Assets/" + assetPath.TrimStart('/');
            if (AssetDatabase.IsValidFolder(assetPath)) return;

            var parts = assetPath.Split('/').Where(x => !string.IsNullOrWhiteSpace(x)).ToArray();
            var cur = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                var next = cur + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(cur, parts[i]);
                cur = next;
            }
        }

        private static GameObject ResolveModelGameObject(string modelAssetPath)
        {
            var ext = (Path.GetExtension(modelAssetPath) ?? "").ToLowerInvariant();

            // Direct load works for FBX (as a ModelPrefab) and for many prefab cases.
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(modelAssetPath);
            if (go != null) return go;

            // VRM importers sometimes create a prefab beside the vrm.
            if (ext == ".vrm")
            {
                var dir = Path.GetDirectoryName(modelAssetPath).Replace("\\", "/");
                var name = Path.GetFileNameWithoutExtension(modelAssetPath);

                // 1) Try same-name prefab in same folder
                var prefabCandidate = (dir + "/" + name + ".prefab").Replace("\\", "/");
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabCandidate);
                if (prefab != null) return prefab;

                // 2) Find any prefab/gameobject in that folder
                var guids = AssetDatabase.FindAssets("t:GameObject " + name, new[] { dir });
                foreach (var g in guids)
                {
                    var p = AssetDatabase.GUIDToAssetPath(g);
                    var x = AssetDatabase.LoadAssetAtPath<GameObject>(p);
                    if (x != null) return x;
                }

                // 3) Fallback: any GameObject in folder
                var any = AssetDatabase.FindAssets("t:GameObject", new[] { dir });
                foreach (var g in any)
                {
                    var p = AssetDatabase.GUIDToAssetPath(g);
                    var x = AssetDatabase.LoadAssetAtPath<GameObject>(p);
                    if (x != null) return x;
                }
            }

            return null;
        }

        private static AnimationClip ResolveAnimationClip(string animAssetPath)
        {
            var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(animAssetPath);
            if (clip != null) return clip;

            var dir = Path.GetDirectoryName(animAssetPath).Replace("\\", "/");
            var name = Path.GetFileNameWithoutExtension(animAssetPath);

            var guids = AssetDatabase.FindAssets("t:AnimationClip " + name, new[] { dir });
            foreach (var g in guids)
            {
                var p = AssetDatabase.GUIDToAssetPath(g);
                var c = AssetDatabase.LoadAssetAtPath<AnimationClip>(p);
                if (c != null) return c;
            }

            var any = AssetDatabase.FindAssets("t:AnimationClip", new[] { dir });
            foreach (var g in any)
            {
                var p = AssetDatabase.GUIDToAssetPath(g);
                var c = AssetDatabase.LoadAssetAtPath<AnimationClip>(p);
                if (c != null) return c;
            }

            return null;
        }

        private static List<string> GetArgs(string[] args, string key)
        {
            var list = new List<string>();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == key)
                {
                    var v = args[i + 1];
                    if (!string.IsNullOrWhiteSpace(v)) list.Add(v);
                }
            }
            return list;
        }

        private static string GetArg(string[] args, string key)
        {
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == key) return args[i + 1];
            return null;
        }

    }
}
#endif
