//! Sincroniza o acervo com `https://api.superaudio.com.br/api/syncplay/acervo/...`
//! e grava os artefatos em `C:/SyncPlay/Library/*.json`.

use crate::error::{AppError, AppResult};
use reqwest::Client;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use tokio::time::Duration;

const LIBRARY_DIR: &str = "C:/SyncPlay/Library";
const ACERVO_API_BASE: &str = "https://api.superaudio.com.br/api/syncplay/acervo";
const PAGE_HINT: usize = 1000;
const MAX_PAGES: u32 = 512;

#[derive(Clone, Copy)]
enum RelationKind {
    Category,
    Style,
    Rhythm,
    Nationality,
    Artist,
}

struct FilterHarvest {
    categories: BTreeMap<String, String>,
    styles: BTreeMap<String, String>,
    rhythms: BTreeMap<String, String>,
    nationalities: BTreeMap<String, String>,
    artists: BTreeMap<String, String>,
    collections: BTreeMap<String, String>,
    medias_type: BTreeMap<String, String>,
    tag_bumper: BTreeMap<String, String>,
}

impl FilterHarvest {
    fn new() -> Self {
        Self {
            categories: BTreeMap::new(),
            styles: BTreeMap::new(),
            rhythms: BTreeMap::new(),
            nationalities: BTreeMap::new(),
            artists: BTreeMap::new(),
            collections: BTreeMap::new(),
            medias_type: BTreeMap::new(),
            tag_bumper: BTreeMap::new(),
        }
    }

    fn insert_relation(&mut self, kind: RelationKind, id_s: String, label: String) {
        let lbl = label.trim();
        let label_own = if lbl.is_empty() {
            id_s.clone()
        } else {
            lbl.to_string()
        };
        let slot = match kind {
            RelationKind::Category => &mut self.categories,
            RelationKind::Style => &mut self.styles,
            RelationKind::Rhythm => &mut self.rhythms,
            RelationKind::Nationality => &mut self.nationalities,
            RelationKind::Artist => &mut self.artists,
        };
        slot.entry(id_s).or_insert(label_own);
    }

    fn ingest_relation_obj(&mut self, kind: RelationKind, maybe: Option<&Map<String, Value>>) {
        let Some(obj) = maybe else { return };
        let Some(id_s) = stringify_val_opt(obj.get("id"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        else {
            return;
        };
        let label = obj
            .get("name")
            .or_else(|| obj.get("nome"))
            .or_else(|| obj.get("category"))
            .or_else(|| obj.get("categoria"))
            .or_else(|| obj.get("description"))
            .and_then(nonempty_str)
            .unwrap_or_else(|| id_s.clone());
        self.insert_relation(kind, id_s, label);
    }

    fn ingest_music(&mut self, item: &Value) {
        self.ingest_relation_obj(RelationKind::Category, obj_map(item.get("category")));
        self.ingest_relation_obj(RelationKind::Category, obj_map(item.get("categoria")));
        self.ingest_relation_obj(RelationKind::Style, obj_map(item.get("style")));
        self.ingest_relation_obj(RelationKind::Style, obj_map(item.get("estilo")));
        self.ingest_relation_obj(RelationKind::Rhythm, obj_map(item.get("rhythm")));
        self.ingest_relation_obj(RelationKind::Rhythm, obj_map(item.get("ritmo")));
        self.ingest_relation_obj(RelationKind::Nationality, obj_map(item.get("nationality")));
        self.ingest_relation_obj(RelationKind::Nationality, obj_map(item.get("nacionalidade")));

        if let (Some(id_s), lbl) =
            pairing_from_scalar_id(item, "id_category", &["category_name", "nome_category"])
        {
            self.insert_relation(RelationKind::Category, id_s, lbl.unwrap_or_default());
        }
        if let (Some(id_s), lbl) =
            pairing_from_scalar_id(item, "id_style", &["style_label", "estilo_label"])
        {
            self.insert_relation(RelationKind::Style, id_s, lbl.unwrap_or_default());
        }
        if let (Some(id_s), lbl) =
            pairing_from_scalar_id(item, "id_rhythm", &["rhythm_label", "ritmo_label"])
        {
            self.insert_relation(RelationKind::Rhythm, id_s, lbl.unwrap_or_default());
        }
        if let (Some(id_s), lbl) = pairing_from_scalar_id(
            item,
            "id_nationality",
            &["nationality_label", "country", "pais"],
        ) {
            self.insert_relation(RelationKind::Nationality, id_s, lbl.unwrap_or_default());
        }

        self.ingest_relation_obj(RelationKind::Artist, obj_map(item.get("artist")));
        self.ingest_relation_obj(RelationKind::Artist, obj_map(item.get("artista")));
        self.ingest_relation_obj(RelationKind::Artist, obj_map(item.get("interpreter")));
        self.ingest_relation_obj(RelationKind::Artist, obj_map(item.get("interprete")));

        if let (Some(id_s), lbl) = pairing_from_scalar_id(
            item,
            "id_artist",
            &["artist_name", "artist_label", "nome_artista"],
        ) {
            self.insert_relation(RelationKind::Artist, id_s, lbl.unwrap_or_default());
        }

        // Ex.: `"artist": 58127` + `"artist_name": "Foo"` (sem objeto aninhado)
        if let Some(aname) = nonempty_hint(item.get("artist_name"))
            .or_else(|| nonempty_hint(item.get("nome_artista")))
            .or_else(|| nonempty_hint(item.get("artist_label")))
        {
            if let Some(id_s) = stringify_val_opt(item.get("artist").or_else(|| item.get("artista")))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            {
                self.insert_relation(RelationKind::Artist, id_s, aname);
            }
        }

        ingest_collection_array(&mut self.collections, item.get("collections"));
        ingest_collection_array(&mut self.collections, item.get("colecoes"));
    }

    fn ingest_media_relation_maps(&mut self, item: &Value) {
        if let Some(o) = obj_map(item.get("medias_type")) {
            ingest_type_or_tag_into(&mut self.medias_type, o);
        }
        if let Some(o) = obj_map(item.get("media_type")).or_else(|| obj_map(item.get("tipo"))) {
            ingest_type_or_tag_into(&mut self.medias_type, o);
        }
        if let Some(o) = obj_map(item.get("tag_bumper")).or_else(|| obj_map(item.get("tag"))) {
            ingest_type_or_tag_into(&mut self.tag_bumper, o);
        }

        let id_med = stringify_val_opt(item.get("id_medias_type").or_else(|| item.get("id_media_type")))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if let Some(id_s) = id_med {
            let lbl = nonempty_hint(item.get("medias_type_name"))
                .or_else(|| nonempty_hint(item.get("media_type_label")))
                .unwrap_or_else(|| id_s.clone());
            self.medias_type.entry(id_s).or_insert(lbl);
        }

        ingest_collection_array(&mut self.collections, item.get("collections"));
        ingest_collection_array(&mut self.collections, item.get("colecoes"));
    }
}

fn stringify_val_opt(v: Option<&Value>) -> Option<String> {
    v.and_then(stringify_val)
}

fn nonempty_hint(v: Option<&Value>) -> Option<String> {
    nonempty_str(v?)
}

fn pairing_from_scalar_id(
    item: &Value,
    id_key: &str,
    label_keys: &[&str],
) -> (Option<String>, Option<String>) {
    let id_s = stringify_val_opt(item.get(id_key))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let lbl = label_keys.iter().find_map(|k| item.get(*k)).and_then(nonempty_str);
    (id_s, lbl)
}

fn ingest_type_or_tag_into(map: &mut BTreeMap<String, String>, o: &Map<String, Value>) {
    let Some(id_s) = stringify_val_opt(o.get("id"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    let label = o
        .get("name")
        .or_else(|| o.get("nome"))
        .or_else(|| o.get("description"))
        .and_then(nonempty_str)
        .unwrap_or_else(|| id_s.clone());
    map.entry(id_s).or_insert(label);
}

fn ingest_collection_array(map: &mut BTreeMap<String, String>, v: Option<&Value>) {
    let Some(Value::Array(arr)) = v else { return };
    for c in arr {
        match c {
            Value::Object(o) => {
                let Some(cid) = stringify_val_opt(o.get("id"))
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                else {
                    continue;
                };
                let name = o
                    .get("name")
                    .or_else(|| o.get("nome"))
                    .or_else(|| o.get("title"))
                    .and_then(nonempty_str)
                    .unwrap_or_else(|| cid.clone());
                map.entry(cid).or_insert(name);
            }
            Value::String(s) => {
                let t = s.trim();
                if !t.is_empty() {
                    map.entry(t.to_string()).or_insert_with(|| t.to_string());
                }
            }
            Value::Number(n) => {
                let id_s = n.to_string();
                map.entry(id_s.clone()).or_insert(id_s);
            }
            _ => {}
        }
    }
}

fn obj_map(v: Option<&Value>) -> Option<&Map<String, Value>> {
    v.and_then(Value::as_object)
}

fn nonempty_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn stringify_val(v: &Value) -> Option<String> {
    nonempty_str(v)
}

pub async fn run_library_update(auth_code: &str) -> AppResult<()> {
    let auth = auth_code.trim();
    if auth.is_empty() {
        return Err(AppError::Network(
            "Código da estação ausente.".into(),
        ));
    }

    std::fs::create_dir_all(Path::new(LIBRARY_DIR))?;

    let client = Client::builder()
        .user_agent("syncplay-v2/0.1 (Tauri)")
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let enc = urlencoding::encode(auth);
    let raw_musics = fetch_category_pages(&client, &enc, "MUSICS_DOWNLOAD").await?;
    let raw_medias = fetch_category_pages(&client, &enc, "MEDIAS_DOWNLOAD").await?;

    let mut harvest_music = FilterHarvest::new();
    let music_library = assemble_music_library(&raw_musics, &mut harvest_music)?;

    let mut harvest_media = FilterHarvest::new();
    let media_library = assemble_media_library(&raw_medias, &mut harvest_media)?;

    let music_filters = music_filters_json(&harvest_music);
    let media_filters = media_filters_json(&harvest_music, &harvest_media);

    write_json_file("music_library.json", &music_library)?;
    write_json_file("music_by_collection.json", &assemble_by_collections(&music_library))?;
    write_json_file("music_filters.json", &music_filters)?;
    write_json_file("media_library.json", &media_library)?;
    write_json_file(
        "media_by_collection.json",
        &assemble_by_collections(&media_library),
    )?;
    write_json_file("media_filters.json", &media_filters)?;

    Ok(())
}

async fn fetch_category_pages(
    client: &Client,
    auth_encoded: &str,
    category: &str,
) -> AppResult<Vec<Value>> {
    let mut out: Vec<Value> = Vec::new();
    for page in 0u32..MAX_PAGES {
        let url = format!("{ACERVO_API_BASE}/{auth_encoded}/{category}/{page}");
        let resp = client.get(&url).send().await?.error_for_status().map_err(|e| {
            AppError::Network(format!("acervo ({category}), página {page}: {e}"))
        })?;

        let body: Value = resp.json().await.map_err(|e| {
            AppError::Network(format!("JSON ({category}), página {page}: {e}"))
        })?;

        let items = extract_page_items(&body);
        if items.is_empty() {
            break;
        }

        let n = items.len();
        out.extend(items);
        if n < PAGE_HINT {
            break;
        }
    }
    Ok(out)
}

fn extract_page_items(root: &Value) -> Vec<Value> {
    if let Value::Array(a) = root {
        return a.clone();
    }
    if let Some(arr) = root.get("content").and_then(Value::as_array).cloned() {
        return arr;
    }
    if let Some(embed) = root.get("_embedded") {
        match embed {
            Value::Array(a) => return a.clone(),
            Value::Object(o) => {
                let mut agg: Vec<Value> = Vec::new();
                for (_k, v) in o {
                    if let Some(a) = v.as_array() {
                        agg.extend(a.clone());
                    } else if v.is_object() {
                        agg.push(v.clone());
                    }
                }
                if !agg.is_empty() {
                    return agg;
                }
            }
            _ => {}
        }
    }
    if root.is_object() {
        let m = root.as_object().unwrap();
        if !(m.contains_key("content") || m.contains_key("_embedded") || m.contains_key("_pageable")) {
            return vec![root.clone()];
        }
    }
    vec![]
}

fn assemble_music_library(items: &[Value], harvest: &mut FilterHarvest) -> AppResult<Value> {
    let mut lib: Map<String, Value> = Map::new();
    for item in items {
        harvest.ingest_music(item);
        let row_map = shallow_normalize_music(item.clone());
        let key_raw = synth_library_row_key(item).or_else(|| row_map.get("audio").cloned());
        let Some(kstr) = unwrap_key_string(key_raw) else {
            continue;
        };
        let key = normalize_file_key_component(&kstr);
        if key.is_empty() {
            continue;
        }
        lib.insert(key, Value::Object(row_map));
    }
    Ok(Value::Object(lib))
}

fn unwrap_key_string(v: Option<Value>) -> Option<String> {
    v.and_then(|x| stringify_val(&x)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn assemble_media_library(items: &[Value], harvest: &mut FilterHarvest) -> AppResult<Value> {
    let mut lib = Map::new();
    for item in items {
        harvest.ingest_media_relation_maps(item);
        let row_map = shallow_normalize_media(item.clone());

        let key_raw = synth_library_row_key(item).or_else(|| row_map.get("audio").cloned());
        let Some(kstr) = unwrap_key_string(key_raw) else {
            continue;
        };
        let key = normalize_file_key_component(&kstr);
        if key.is_empty() {
            continue;
        }
        lib.insert(key, Value::Object(row_map));
    }
    Ok(Value::Object(lib))
}

fn synth_library_row_key(item: &Value) -> Option<Value> {
    for k in ["audio", "path", "fileName", "file_name", "nome", "titulo"].iter() {
        if let Some(v) = item.get(*k) {
            let s = stringify_val(v)?.trim().to_string();
            if !s.is_empty() {
                return Some(Value::String(normalize_file_key_component(&s)));
            }
        }
    }

    for p in ["/audio", "/path"] {
        if let Some(v) = item.pointer(p) {
            if let Some(s) = stringify_val(v) {
                let t = s.trim();
                if !t.is_empty() {
                    return Some(Value::String(normalize_file_key_component(t)));
                }
            }
        }
    }

    if let Value::Object(o) = item {
        for nk in ["arquivo", "file", "media"] {
            if let Some(inner) = o.get(nk) {
                let candidate = match inner {
                    Value::Object(io) => io
                        .get("path")
                        .or_else(|| io.get("nome"))
                        .or_else(|| io.get("name"))
                        .and_then(stringify_val),
                    _ => stringify_val(inner),
                };
                if let Some(ps) = candidate {
                    let t = ps.trim();
                    if !t.is_empty() {
                        return Some(Value::String(normalize_file_key_component(t)));
                    }
                }
            }
        }
    }

    if let Some(s) =
        stringify_val_opt(item.get("id")).filter(|id| id.trim_matches(|c: char| c.is_whitespace()).len() > 0)
    {
        return Some(Value::String(format!(
            "__id_{}",
            s.trim()
        )));
    }

    None
}

fn normalize_file_key_component(s: &str) -> String {
    s.trim().replace('\\', "/")
}

fn shallow_normalize_music(item: Value) -> Map<String, Value> {
    let mut m = match item {
        Value::Object(map) => map,
        _ => Map::new(),
    };

    let keys_to_flat = [
        "category",
        "categoria",
        "style",
        "estilo",
        "rhythm",
        "ritmo",
        "nationality",
        "nacionalidade",
        "collections",
        "colecoes",
        "collections_ids",
        "colecoes_ids",
    ];

    flatten_keys_list(&keys_to_flat, &mut m);
    m
}

fn shallow_normalize_media(item: Value) -> Map<String, Value> {
    let mut m = match item {
        Value::Object(map) => map,
        _ => Map::new(),
    };

    let keys_to_flat = [
        "collections",
        "colecoes",
        "collections_ids",
        "colecoes_ids",
        "media_type",
        "medias_type",
        "tipo",
        "tag_bumper",
        "tag",
        "category",
        "categoria",
    ];
    flatten_keys_list(&keys_to_flat, &mut m);
    m
}

fn flatten_keys_list(keys_to_flat: &[&str], m: &mut Map<String, Value>) {
    for k in keys_to_flat {
        if let Some(v) = m.get_mut(*k) {
            let t = v.take();
            *v = flatten_relation_value(t);
        }
    }
}

fn flatten_relation_value(v: Value) -> Value {
    match v {
        Value::Object(o) if o.contains_key("id") && o.len() <= 24 => {
            o.get("id").cloned().unwrap_or(Value::Object(o))
        }
        Value::Array(arr) => Value::Array(
            arr.into_iter()
                .map(|e| match e {
                    Value::Object(oo)
                        if oo.contains_key("id") && oo.len() <= 24 =>
                    {
                        oo.get("id").cloned().unwrap_or(Value::Object(oo))
                    }
                    other => other,
                })
                .collect(),
        ),
        other => other,
    }
}

fn collection_entry_key(c: &Value) -> Option<String> {
    match c {
        Value::Object(o) => stringify_val_opt(o.get("id"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        Value::String(s) => {
            let t = s.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        }
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn assemble_by_collections(lib_root: &Value) -> Value {
    let Some(map) = lib_root.as_object() else {
        return json!({});
    };
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (file_key, row) in map.iter() {
        ingest_row_collections_into(&mut out, row, file_key);

        let single_vals = [row.get("collection_id"), row.get("id_collection")];
        for sv in single_vals.into_iter().flatten() {
            if let Some(cid) =
                stringify_val_opt(Some(sv)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
            {
                out.entry(cid).or_default().insert(file_key.clone());
            }
        }
    }

    serde_json::to_value(
        out.into_iter()
            .map(|(k, vs)| (k, vs.into_iter().collect::<Vec<_>>()))
            .collect::<BTreeMap<String, Vec<String>>>(),
    )
    .unwrap_or_else(|_| json!({}))
}

fn ingest_row_collections_into(
    out: &mut BTreeMap<String, BTreeSet<String>>,
    row: &Value,
    file_key: &str,
) {
    if let Value::Object(obj) = row {
        let coll_vals = [
            obj.get("collections"),
            obj.get("colecoes"),
            obj.get("collection"),
        ];

        let mut any = false;
        for cv in coll_vals.into_iter().flatten() {
            if let Value::Array(arr) = cv {
                for c in arr {
                    if let Some(cid) = collection_entry_key(c) {
                        out.entry(cid).or_default().insert(file_key.to_string());
                        any = true;
                    }
                }
            } else if let Some(cid) =
                stringify_val_opt(Some(cv)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
            {
                out.entry(cid).or_default().insert(file_key.to_string());
                any = true;
            }
        }
        if any {
            return;
        }
    }
}

fn btree_to_json_map(bt: &BTreeMap<String, String>) -> Map<String, Value> {
    bt.iter()
        .map(|(k, v)| (k.clone(), Value::String(v.clone())))
        .collect()
}

fn music_filters_json(h: &FilterHarvest) -> Value {
    let categories = btree_to_json_map(&h.categories);
    let styles = btree_to_json_map(&h.styles);
    let rhythms = btree_to_json_map(&h.rhythms);
    let nationalities = btree_to_json_map(&h.nationalities);
    let artists = btree_to_json_map(&h.artists);
    let collections = btree_to_json_map(&h.collections);

    json!({
        "categories": categories.clone(),
        "category": categories,
        "styles": styles.clone(),
        "style": styles,
        "rhythms": rhythms.clone(),
        "rhythm": rhythms,
        "ritmos": rhythms,
        "estilos": styles,
        "nationalities": nationalities.clone(),
        "nationality": nationalities,
        "paises": nationalities,
        "artists": artists.clone(),
        "artist": artists,
        "collections": collections.clone(),
        "collection": collections,
        "colecoes": collections,
    })
}

fn media_filters_json(music: &FilterHarvest, media: &FilterHarvest) -> Value {
    let types = btree_to_json_map(&media.medias_type);
    let tags = btree_to_json_map(&media.tag_bumper);

    let mut merged_cols = BTreeMap::new();
    for (k, v) in music.collections.iter().chain(media.collections.iter()) {
        merged_cols.entry(k.clone()).or_insert_with(|| v.clone());
    }
    let collections = btree_to_json_map(&merged_cols);

    json!({
        "medias_type": types.clone(),
        "media_types": types.clone(),
        "types": types,
        "tag_bumper": tags.clone(),
        "tags": tags.clone(),
        "collections": collections.clone(),
        "collection": collections.clone(),
    })
}

fn write_json_file(name: &str, value: &Value) -> AppResult<()> {
    let path = Path::new(LIBRARY_DIR).join(name);
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let text = serde_json::to_string_pretty(value)?;
    std::fs::write(path, text)?;
    Ok(())
}
