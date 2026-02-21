use std::env;
use std::fs::{self, File};
use std::io::{Write};
use std::path::Path;
use zip::write::{FileOptions, ZipWriter};
use walkdir::WalkDir;

fn main() {
    let out_dir = env::var("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("static.zip");
    
    // We want to compress everything in "static/" into "static.zip"
    // and place it in the OUT_DIR for inclusion.
    
    println!("cargo:rerun-if-changed=static");

    let file = File::create(&dest_path).unwrap();
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::<()>::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    let mut file_count = 0;
    let walker = WalkDir::new("static").into_iter();
    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path.strip_prefix(Path::new("static")).unwrap();
        let path_as_string = name.to_str().map(str::to_owned).unwrap();
        
        // Skip root
        if name.as_os_str().is_empty() {
            continue;
        }

        if path.is_file() {
            zip.start_file(path_as_string, options).unwrap();
            let content = fs::read(path).unwrap();
            zip.write_all(&content).unwrap();
            file_count += 1;
        } else if !name.as_os_str().is_empty() {
             zip.add_directory(path_as_string, options).unwrap();
        }
    }
    zip.finish().unwrap();

    // Now copy it to assets/static.zip so include_bytes! finds it easily
    // Or we can just use include_bytes!(concat!(env!("OUT_DIR"), "/static.zip"))
    // But to match current setup, let's just make sure assets/ exists and copy it there.
    
    let assets_dir = Path::new("assets");
    if !assets_dir.exists() {
        fs::create_dir(assets_dir).unwrap();
    }
    fs::copy(&dest_path, "assets/static.zip").unwrap();
    println!("cargo:warning=Packed {} files into assets/static.zip", file_count);
}
