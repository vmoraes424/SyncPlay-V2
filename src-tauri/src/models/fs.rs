use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct DirFileEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}
