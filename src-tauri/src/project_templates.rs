//! Builtin, declarative starter packages. Instantiation copies their complete
//! type/template snapshot; opening a project never resolves this catalogue.
use super::{io_error, layout_fields, validate_file_tree, validate_manifest, Result, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

const CATALOG: &str = include_str!("../../scripts/lib/project-templates.json");
const LAYOUT: &str = include_str!("../../scripts/lib/workspace-layout.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Catalog {
    format: String,
    version: u32,
    default_template: String,
    legacy_template: String,
    templates: Vec<ProjectTemplate>,
    #[serde(default)]
    compatibility_templates: Vec<ProjectTemplate>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectTemplate {
    format: String,
    schema_version: u32,
    package_id: String,
    version: String,
    label: String,
    description: String,
    pub document_types: Vec<Value>,
    pub templates: BTreeMap<String, String>,
}

impl ProjectTemplate {
    fn validate(&self) -> Result<()> {
        let id_valid = self.package_id.len() <= 120
            && self.package_id.split('.').count() >= 2
            && self.package_id.split('.').all(|part| {
                part.starts_with(|c: char| c.is_ascii_lowercase())
                    && part
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            });
        let version_valid = self.version.split('.').count() == 3
            && self.version.split('.').all(|part| {
                !part.is_empty()
                    && (part == "0" || !part.starts_with('0'))
                    && part.bytes().all(|c| c.is_ascii_digit())
                    && part.parse::<u32>().is_ok()
            });
        if self.format != "viento-project-template"
            || self.schema_version != 1
            || !id_valid
            || !version_valid
            || self.label.trim().is_empty()
            || self.label.len() > 480
            || self.description.len() > 2048
        {
            return Err("工程模板包格式无效".into());
        }
        let mut extra = layout_fields(3);
        extra.insert("documentTypes".into(), json!(self.document_types));
        validate_manifest(&Workspace {
            format: "viento-workspace".into(),
            version: 3,
            id: "00000000-0000-0000-0000-000000000001".into(),
            name: "template-validation".into(),
            created_at: 0,
            extra,
        })?;
        let required: HashSet<_> = self
            .document_types
            .iter()
            .filter_map(|definition| definition["template"].as_str())
            .collect();
        if required.len() != self.templates.len()
            || required
                .iter()
                .any(|file| !self.templates.contains_key(*file))
            || self
                .templates
                .values()
                .any(|content| content.len() > 1024 * 1024)
        {
            return Err("工程模板包的类型与模板文件不匹配".into());
        }
        validate_file_tree(self.templates.keys().map(String::as_str))
    }

    pub fn provenance(&self) -> Value {
        // serde_json::Value sorts object keys, so the digest is independent of
        // the catalogue's formatting or the project's chosen name and UUID.
        let content = serde_json::to_vec(&serde_json::to_value(self).unwrap()).unwrap();
        json!({ "packageId": self.package_id, "version": self.version,
            "digest": format!("sha256:{:x}", Sha256::digest(content)) })
    }
}

fn catalog() -> Result<Catalog> {
    let catalog: Catalog = serde_json::from_str(CATALOG).map_err(io_error)?;
    if catalog.format != "viento-project-template-catalog" || catalog.version != 1 {
        return Err("工程模板目录格式无效".into());
    }
    let mut ids = HashSet::new();
    for template in catalog
        .templates
        .iter()
        .chain(&catalog.compatibility_templates)
    {
        template.validate()?;
        if !ids.insert(&template.package_id) {
            return Err("工程模板标识重复".into());
        }
    }
    if !catalog
        .templates
        .iter()
        .any(|template| template.package_id == catalog.default_template)
        || !ids.contains(&catalog.legacy_template)
    {
        return Err("工程模板目录缺少默认模板".into());
    }
    Ok(catalog)
}

pub fn list() -> Result<Value> {
    let catalog = catalog()?;
    Ok(json!({ "defaultTemplate": catalog.default_template,
        "templates": catalog.templates.iter().map(|template| json!({
            "packageId": template.package_id, "version": template.version,
            "label": template.label, "description": template.description,
        })).collect::<Vec<_>>() }))
}

pub fn select(id: &str) -> Result<ProjectTemplate> {
    let catalog = catalog()?;
    catalog
        .templates
        .into_iter()
        .chain(catalog.compatibility_templates)
        .find(|template| template.package_id == id)
        .ok_or_else(|| "工程模板不存在，请重新选择".into())
}

// Compatibility only: pre-catalogue callers and implicit v2/v3 manifests retain
// their historical OC defaults. These are not the new-project UI's default.
pub fn legacy_defaults() -> Value {
    let catalog: Value = serde_json::from_str(CATALOG).expect("valid builtin catalogue");
    let legacy = catalog["templates"]
        .as_array()
        .unwrap()
        .iter()
        .chain(
            catalog["compatibilityTemplates"]
                .as_array()
                .into_iter()
                .flatten(),
        )
        .find(|template| template["packageId"] == catalog["legacyTemplate"])
        .unwrap();
    let mut layout: Value = serde_json::from_str(LAYOUT).expect("valid workspace layout");
    layout["documentTypes"] = legacy["documentTypes"].clone();
    layout["templates"] = legacy["templates"].clone();
    layout
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packages_are_closed_and_reject_ambiguous_or_escaping_templates() {
        let catalog = catalog().unwrap();
        assert_eq!(catalog.default_template, "org.viento.blank");
        assert_eq!(catalog.templates.len(), 5);
        assert_eq!(catalog.compatibility_templates.len(), 1);
        assert!(!list().unwrap()["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|template| template["packageId"] == "org.viento.oc-narrative"));
        let legacy = select("org.viento.oc-narrative").unwrap();
        assert_eq!(legacy.document_types.len(), 6);
        assert_eq!(
            legacy.provenance()["digest"],
            "sha256:30545b1162327ee60172cdbe0255a3f85729f668d036a7ff358be8259fe1dc90"
        );
        assert!(select("missing.package").is_err());
        for file in [
            "../outside.md",
            "other.md",
            "DOCUMENT.md",
            "document.md/child.md",
        ] {
            let mut template = select("org.viento.blank").unwrap();
            template.templates.insert(file.into(), "# Content".into());
            template
                .document_types
                .push(json!({"id":"other","label":"Other","directory":"other",
                "parserProfile":"structured","template":file}));
            if file == "other.md" {
                template.templates.remove("document.md");
            }
            assert!(template.validate().is_err(), "{file}");
        }
        let mut template = select("org.viento.blank").unwrap();
        template.schema_version = 2;
        assert!(template.validate().is_err());
    }
}
