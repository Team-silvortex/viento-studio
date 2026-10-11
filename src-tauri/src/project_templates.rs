//! Builtin, declarative starter packages. Instantiation copies their complete
//! type/template snapshot; opening a project never resolves this catalogue.
use super::{
    io_error, layout_fields, validate_file_tree, validate_manifest, validate_studio_profile,
    Result, Workspace,
};
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
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_studio_profile"
    )]
    pub studio_profile: Option<Value>,
}

// Only an absent field is optional. Preserve an explicit null so validation
// rejects it instead of silently dropping an invalid project requirement.
fn deserialize_studio_profile<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
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
        if let Some(profile) = &self.studio_profile {
            validate_studio_profile(profile)?;
            extra.insert("studioProfile".into(), profile.clone());
        }
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
        let mut value = serde_json::to_value(self).unwrap();
        // JSON integer values such as 1.0 and 1e0 have the same meaning in the
        // Node planner. Normalize only validated profile numbers in this digest
        // copy; the template and its authored workspace snapshot stay intact.
        if let Some(profile) = value.get_mut("studioProfile") {
            if validate_studio_profile(profile).is_ok() {
                profile["schemaVersion"] = Value::Number(serde_json::Number::from(1_u64));
                for key in ["required", "optional"] {
                    for request in profile[key].as_array_mut().unwrap() {
                        let version = request["apiVersion"].as_f64().unwrap() as u64;
                        request["apiVersion"] = Value::Number(serde_json::Number::from(version));
                    }
                }
            }
        }
        let content = serde_json::to_vec(&value).unwrap();
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
    fn absent_studio_profiles_preserve_builtin_serialization_and_provenance() {
        let raw: Value = serde_json::from_str(CATALOG).unwrap();
        for expected in raw["templates"]
            .as_array()
            .unwrap()
            .iter()
            .chain(raw["compatibilityTemplates"].as_array().unwrap())
        {
            let template = select(expected["packageId"].as_str().unwrap()).unwrap();
            assert!(template.studio_profile.is_none());
            assert_eq!(serde_json::to_value(&template).unwrap(), *expected);
            let bytes = serde_json::to_vec(expected).unwrap();
            assert_eq!(
                template.provenance()["digest"],
                format!("sha256:{:x}", Sha256::digest(bytes))
            );
        }
    }

    #[test]
    fn studio_profile_snapshots_are_validated_and_part_of_template_provenance() {
        let original = select("org.viento.blank").unwrap();
        let profile = json!({"format":"viento-studio-profile","schemaVersion":1,
            "required":[{"capability":"future.scene3d.edit","apiVersion":1}],
            "optional":[{"capability":"backend.future-rust","apiVersion":65535}]});
        let mut template = original.clone();
        template.studio_profile = Some(profile.clone());
        template.validate().unwrap();
        let value = serde_json::to_value(&template).unwrap();
        assert_eq!(value["studioProfile"], profile);
        assert_ne!(template.provenance(), original.provenance());
        let roundtrip: ProjectTemplate = serde_json::from_value(value).unwrap();
        roundtrip.validate().unwrap();
        assert_eq!(roundtrip.provenance(), template.provenance());
    }

    #[test]
    fn studio_profile_provenance_matches_node_integer_semantics_without_rewriting_values() {
        // Computed by Node 24.20.0 with engine/canonical-json.mjs over the same
        // builtin package and profile, including its sorted nested keys.
        let expected = "sha256:4b6196aa80f3d8c2260120f5bcd074bb0f5032bc51b39e9e0d9955b10452aa4f";
        let integer_profile = json!({"format":"viento-studio-profile","schemaVersion":1,
            "required":[{"capability":"future.scene3d.edit","apiVersion":1}],
            "optional":[{"capability":"backend.future-rust","apiVersion":65535}]});
        for profile in [
            integer_profile,
            serde_json::from_str(r#"{"format":"viento-studio-profile","schemaVersion":1.0,"required":[{"capability":"future.scene3d.edit","apiVersion":1.0}],"optional":[{"capability":"backend.future-rust","apiVersion":65535.0}]}"#).unwrap(),
            serde_json::from_str(r#"{"format":"viento-studio-profile","schemaVersion":1e0,"required":[{"capability":"future.scene3d.edit","apiVersion":1e0}],"optional":[{"capability":"backend.future-rust","apiVersion":65535e0}]}"#).unwrap(),
        ] {
            let mut template = select("org.viento.blank").unwrap();
            template.studio_profile = Some(profile.clone());
            template.validate().unwrap();
            let before = serde_json::to_vec(&template).unwrap();
            let profile_bytes = serde_json::to_vec(&profile).unwrap();
            assert_eq!(template.provenance()["digest"], expected);
            assert_eq!(serde_json::to_vec(&template).unwrap(), before);
            assert_eq!(serde_json::to_vec(template.studio_profile.as_ref().unwrap()).unwrap(), profile_bytes);
            let temp = tempfile::tempdir().unwrap();
            let root = super::super::create_workspace_contents(
                temp.path(),
                "Integer profile",
                None,
                None,
                Some(template.clone()),
            )
            .unwrap();
            let workspace = super::super::ensure_workspace(&root).unwrap();
            assert_eq!(
                serde_json::to_vec(&workspace.extra["studioProfile"]).unwrap(),
                profile_bytes
            );
        }
    }

    #[test]
    fn explicit_null_and_malformed_template_profiles_are_not_treated_as_absent() {
        let original = serde_json::to_value(select("org.viento.blank").unwrap()).unwrap();
        for profile in [
            Value::Null,
            json!({"format":"viento-studio-profile","schemaVersion":1,"required":[]}),
            json!({"format":"viento-studio-profile","schemaVersion":1,"required":[],
                "optional":[],"script":"do-not-run"}),
            json!({"format":"viento-studio-profile","schemaVersion":1,
                "required":[{"capability":"scene.edit","apiVersion":1}],
                "optional":[{"capability":"scene.edit","apiVersion":2}]}),
        ] {
            let mut value = original.clone();
            value["studioProfile"] = profile.clone();
            let template: ProjectTemplate = serde_json::from_value(value).unwrap();
            assert_eq!(template.studio_profile, Some(profile));
            assert!(template.validate().is_err());
        }
    }

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
