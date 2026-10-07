//! Bounded, source-preserving Scene2D position patches. No filesystem or host state.
#![forbid(unsafe_code)]

use crate::CoreError;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::ops::Range;

const MAX_BYTES: usize = 128 * 1024;
const MAX_DEPTH: usize = 64;
const MAX_NODES: usize = 100_000;
const MAX_ACTORS: usize = 128;
const MAX_GROUPS: usize = 128;
const MAX_GROUP_DEPTH: usize = 16;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_source_layout_invalid",
        message: "The source layout does not match a valid scene draft.",
    }
}
fn content_limit() -> CoreError {
    CoreError {
        error_code: "scene_source_layout_content_limit",
        message: "The scene source exceeds 128 KiB.",
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum SceneSourceResponse {
    Inspect {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "actorCount")]
        actor_count: usize,
    },
    Patch {
        #[serde(rename = "afterContent")]
        after_content: String,
        #[serde(rename = "changedPaths")]
        changed_paths: Vec<String>,
    },
}

// Strings use UTF-16 code units so escaped lone surrogates and decoded duplicate
// keys have exactly JavaScript's meaning without corrupting unrelated source.
pub(crate) struct Node {
    pub(crate) span: Range<usize>,
    kind: Kind,
}
enum Kind {
    Object(Vec<(Vec<u16>, Node)>),
    Array(Vec<Node>),
    String(Vec<u16>),
    Number,
    Other,
}
impl Node {
    pub(crate) fn object(&self) -> Result<&[(Vec<u16>, Node)], CoreError> {
        if let Kind::Object(value) = &self.kind {
            Ok(value)
        } else {
            Err(invalid())
        }
    }
    pub(crate) fn array(&self) -> Result<&[Node], CoreError> {
        if let Kind::Array(value) = &self.kind {
            Ok(value)
        } else {
            Err(invalid())
        }
    }
    fn string(&self) -> Result<&[u16], CoreError> {
        if let Kind::String(value) = &self.kind {
            Ok(value)
        } else {
            Err(invalid())
        }
    }
    pub(crate) fn get(&self, key: &str) -> Option<&Node> {
        let Kind::Object(entries) = &self.kind else {
            return None;
        };
        entries
            .iter()
            .find(|(name, _)| name.iter().copied().eq(key.encode_utf16()))
            .map(|(_, value)| value)
    }
    fn require(&self, key: &str) -> Result<&Node, CoreError> {
        self.get(key).ok_or_else(invalid)
    }
    fn number(&self, source: &str) -> Result<f64, CoreError> {
        if !matches!(self.kind, Kind::Number) {
            return Err(invalid());
        }
        source[self.span.clone()]
            .parse::<f64>()
            .map_err(|_| invalid())
    }
}

struct Scanner<'a> {
    source: &'a str,
    cursor: usize,
    nodes: usize,
}
impl<'a> Scanner<'a> {
    fn byte(&self) -> Option<u8> {
        self.source.as_bytes().get(self.cursor).copied()
    }
    fn whitespace(&mut self) {
        while matches!(self.byte(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.cursor += 1;
        }
    }
    fn take(&mut self, expected: u8) -> Result<(), CoreError> {
        if self.byte() != Some(expected) {
            return Err(invalid());
        }
        self.cursor += 1;
        Ok(())
    }
    fn string(&mut self) -> Result<Vec<u16>, CoreError> {
        self.take(b'"')?;
        let mut decoded = Vec::new();
        loop {
            match self.byte().ok_or_else(invalid)? {
                b'"' => {
                    self.cursor += 1;
                    return Ok(decoded);
                }
                b'\\' => {
                    self.cursor += 1;
                    let escape = self.byte().ok_or_else(invalid)?;
                    self.cursor += 1;
                    let unit = match escape {
                        b'"' => 34,
                        b'\\' => 92,
                        b'/' => 47,
                        b'b' => 8,
                        b'f' => 12,
                        b'n' => 10,
                        b'r' => 13,
                        b't' => 9,
                        b'u' => {
                            let mut unit = 0u16;
                            for _ in 0..4 {
                                let digit = match self.byte().ok_or_else(invalid)? {
                                    b'0'..=b'9' => self.byte().unwrap() - b'0',
                                    b'a'..=b'f' => self.byte().unwrap() - b'a' + 10,
                                    b'A'..=b'F' => self.byte().unwrap() - b'A' + 10,
                                    _ => return Err(invalid()),
                                };
                                unit = unit * 16 + u16::from(digit);
                                self.cursor += 1;
                            }
                            unit
                        }
                        _ => return Err(invalid()),
                    };
                    decoded.push(unit);
                }
                0..=31 => return Err(invalid()),
                _ => {
                    let character = self.source[self.cursor..]
                        .chars()
                        .next()
                        .ok_or_else(invalid)?;
                    decoded.extend(character.encode_utf16(&mut [0; 2]).iter().copied());
                    self.cursor += character.len_utf8();
                }
            }
        }
    }
    fn number(&mut self) -> Result<(), CoreError> {
        if self.byte() == Some(b'-') {
            self.cursor += 1;
        }
        match self.byte() {
            Some(b'0') => self.cursor += 1,
            Some(b'1'..=b'9') => {
                self.cursor += 1;
                while matches!(self.byte(), Some(b'0'..=b'9')) {
                    self.cursor += 1;
                }
            }
            _ => return Err(invalid()),
        }
        if self.byte() == Some(b'.') {
            self.cursor += 1;
            if !matches!(self.byte(), Some(b'0'..=b'9')) {
                return Err(invalid());
            }
            while matches!(self.byte(), Some(b'0'..=b'9')) {
                self.cursor += 1;
            }
        }
        if matches!(self.byte(), Some(b'e' | b'E')) {
            self.cursor += 1;
            if matches!(self.byte(), Some(b'+' | b'-')) {
                self.cursor += 1;
            }
            if !matches!(self.byte(), Some(b'0'..=b'9')) {
                return Err(invalid());
            }
            while matches!(self.byte(), Some(b'0'..=b'9')) {
                self.cursor += 1;
            }
        }
        Ok(())
    }
    fn literal(&mut self, value: &str) -> Result<(), CoreError> {
        if !self.source[self.cursor..].starts_with(value) {
            return Err(invalid());
        }
        self.cursor += value.len();
        Ok(())
    }
    fn value(&mut self, depth: usize) -> Result<Node, CoreError> {
        if depth > MAX_DEPTH || self.nodes == MAX_NODES {
            return Err(invalid());
        }
        self.nodes += 1;
        self.whitespace();
        let start = self.cursor;
        let kind = match self.byte().ok_or_else(invalid)? {
            b'{' => {
                self.cursor += 1;
                self.whitespace();
                let mut entries = Vec::new();
                let mut keys = HashSet::new();
                if self.byte() != Some(b'}') {
                    loop {
                        let key = self.string()?;
                        if !keys.insert(key.clone()) {
                            return Err(invalid());
                        }
                        self.whitespace();
                        self.take(b':')?;
                        entries.push((key, self.value(depth + 1)?));
                        self.whitespace();
                        if self.byte() != Some(b',') {
                            break;
                        }
                        self.cursor += 1;
                        self.whitespace();
                    }
                }
                self.take(b'}')?;
                Kind::Object(entries)
            }
            b'[' => {
                self.cursor += 1;
                self.whitespace();
                let mut entries = Vec::new();
                if self.byte() != Some(b']') {
                    loop {
                        entries.push(self.value(depth + 1)?);
                        self.whitespace();
                        if self.byte() != Some(b',') {
                            break;
                        }
                        self.cursor += 1;
                    }
                }
                self.take(b']')?;
                Kind::Array(entries)
            }
            b'"' => Kind::String(self.string()?),
            b'-' | b'0'..=b'9' => {
                self.number()?;
                Kind::Number
            }
            b't' => {
                self.literal("true")?;
                Kind::Other
            }
            b'f' => {
                self.literal("false")?;
                Kind::Other
            }
            b'n' => {
                self.literal("null")?;
                Kind::Other
            }
            _ => return Err(invalid()),
        };
        Ok(Node {
            span: start..self.cursor,
            kind,
        })
    }
    fn parse(source: &'a str) -> Result<Node, CoreError> {
        if source.len() > MAX_BYTES {
            return Err(content_limit());
        }
        let mut scanner = Self {
            source,
            cursor: usize::from(source.starts_with('\u{feff}')) * 3,
            nodes: 0,
        };
        let root = scanner.value(0)?;
        scanner.whitespace();
        if scanner.cursor != source.len() {
            return Err(invalid());
        }
        Ok(root)
    }
}

/// Reuse strict syntax, decoded-key uniqueness and tree budgets without
/// exposing the source-layout scanner or changing its existing semantics.
pub(crate) fn validate_json_source(source: &str) -> Result<(), CoreError> {
    Scanner::parse(source).map(|_| ())
}

/// Byte ranges for another stateless, source-preserving core operation. All
/// syntax, duplicate-key and resource limits remain owned by the same scanner.
pub(crate) fn parse_json_source(source: &str) -> Result<Node, CoreError> {
    Scanner::parse(source)
}

fn uuid(units: &[u16]) -> bool {
    units.len() == 36
        && units.iter().enumerate().all(|(index, unit)| {
            if [8, 13, 18, 23].contains(&index) {
                *unit == 45
            } else {
                matches!(*unit, 48..=57 | 97..=102)
            }
        })
}
fn uuid_node(value: &Node) -> Result<String, CoreError> {
    let value = value.string()?;
    if !uuid(value) {
        return Err(invalid());
    }
    String::from_utf16(value).map_err(|_| invalid())
}
fn js_whitespace(unit: u16) -> bool {
    matches!(unit, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn coordinates(node: &Node, content: &str) -> Result<[f64; 2], CoreError> {
    let pair = node.array()?;
    if pair.len() != 2 {
        return Err(invalid());
    }
    let values = [pair[0].number(content)?, pair[1].number(content)?];
    if values
        .iter()
        .any(|value| !value.is_finite() || value.abs() > 100_000.0)
    {
        return Err(invalid());
    }
    Ok(values)
}

struct Actor<'a> {
    identity: String,
    value: &'a Node,
    position: [f64; 2],
}
struct Scene<'a> {
    version: u8,
    actors: Vec<Actor<'a>>,
}
fn validate<'a>(root: &'a Node, content: &str) -> Result<Scene<'a>, CoreError> {
    root.object()?;
    if !root
        .require("format")?
        .string()?
        .iter()
        .copied()
        .eq("viento-scene2d".encode_utf16())
    {
        return Err(invalid());
    }
    let version = match root.require("schemaVersion")?.number(content)? {
        1.0 => 1,
        2.0 => 2,
        3.0 => 3,
        _ => return Err(invalid()),
    };
    let source_actors = root.require("actors")?.array()?;
    if source_actors.is_empty() || source_actors.len() > MAX_ACTORS {
        return Err(invalid());
    }
    let mut identities = HashSet::new();
    let mut actors = Vec::with_capacity(source_actors.len());
    for actor in source_actors {
        actor.object()?;
        let object_id = uuid_node(actor.require("objectId")?)?;
        let identity = if version == 1 {
            if actor.get("instanceId").is_some() {
                return Err(invalid());
            }
            object_id
        } else {
            uuid_node(actor.require("instanceId")?)?
        };
        if !identities.insert(identity.clone()) {
            return Err(invalid());
        }
        actors.push(Actor {
            identity,
            value: actor,
            position: coordinates(actor.require("position")?, content)?,
        });
    }
    if version != 3 {
        if root.get("groups").is_some()
            || actors
                .iter()
                .any(|actor| actor.value.get("groupId").is_some())
        {
            return Err(invalid());
        }
        return Ok(Scene { version, actors });
    }
    let source_groups = root.require("groups")?.array()?;
    if source_groups.len() > MAX_GROUPS {
        return Err(invalid());
    }
    let mut groups = HashMap::<String, Option<String>>::new();
    for group in source_groups {
        for (key, _) in group.object()? {
            if !["groupId", "name", "parentGroupId"]
                .iter()
                .any(|field| key.iter().copied().eq(field.encode_utf16()))
            {
                return Err(invalid());
            }
        }
        let identity = uuid_node(group.require("groupId")?)?;
        if identities.contains(&identity) || groups.contains_key(&identity) {
            return Err(invalid());
        }
        let name = group.require("name")?.string()?;
        if name.len() > 160
            || !name.iter().any(|unit| !js_whitespace(*unit))
            || name.iter().any(|unit| *unit <= 31 || *unit == 127)
        {
            return Err(invalid());
        }
        let parent = group.get("parentGroupId").map(uuid_node).transpose()?;
        groups.insert(identity, parent);
    }
    for group in groups.keys() {
        let mut seen = HashSet::new();
        let mut cursor = Some(group);
        while let Some(id) = cursor {
            if !seen.insert(id) || seen.len() > MAX_GROUP_DEPTH {
                return Err(invalid());
            }
            cursor = groups.get(id).ok_or_else(invalid)?.as_ref();
        }
    }
    for actor in &actors {
        if let Some(group) = actor.value.get("groupId") {
            if !groups.contains_key(&uuid_node(group)?) {
                return Err(invalid());
            }
        }
    }
    Ok(Scene { version, actors })
}

// Exact distance comparison is only used to resolve the handful of shortest
// decimal spellings which round-trip to the same binary float. JavaScript picks
// the nearest spelling and resolves an exact tie with an even significand;
// Rust's default formatting can choose the other tie (for example 2^-25).
// Values are bounded f64 coordinates, so these integers stay below 1200 bits.
#[derive(Clone, PartialEq, Eq)]
struct Natural(Vec<u32>);
impl Natural {
    fn new(value: u64) -> Self {
        let mut result = Self(vec![value as u32, (value >> 32) as u32]);
        result.trim();
        result
    }
    fn trim(&mut self) {
        while self.0.last() == Some(&0) {
            self.0.pop();
        }
    }
    fn times_five(&mut self) {
        let mut carry = 0u64;
        for digit in &mut self.0 {
            let next = u64::from(*digit) * 5 + carry;
            *digit = next as u32;
            carry = next >> 32;
        }
        if carry != 0 {
            self.0.push(carry as u32);
        }
    }
    fn shifted(mut self, bits: usize) -> Self {
        if self.0.is_empty() {
            return self;
        }
        let words = bits / 32;
        let bits = bits % 32;
        let mut output = vec![0; words];
        let mut carry = 0u64;
        for digit in self.0 {
            let next = (u64::from(digit) << bits) | carry;
            output.push(next as u32);
            carry = next >> 32;
        }
        if carry != 0 {
            output.push(carry as u32);
        }
        self.0 = output;
        self
    }
    fn compare(&self, other: &Self) -> std::cmp::Ordering {
        self.0
            .len()
            .cmp(&other.0.len())
            .then_with(|| self.0.iter().rev().cmp(other.0.iter().rev()))
    }
    fn distance(&self, other: &Self) -> Self {
        let (larger, smaller) = if self.compare(other).is_lt() {
            (other, self)
        } else {
            (self, other)
        };
        let mut output = Vec::with_capacity(larger.0.len());
        let mut borrow = 0i64;
        for (index, digit) in larger.0.iter().enumerate() {
            let next = i64::from(*digit) - i64::from(*smaller.0.get(index).unwrap_or(&0)) - borrow;
            output.push(next as u32);
            borrow = i64::from(next < 0);
        }
        let mut result = Self(output);
        result.trim();
        result
    }
}
fn canonical_significand(value: f64, coefficient: u64, exponent: i32) -> u64 {
    let bits = value.to_bits();
    let encoded_exponent = ((bits >> 52) & 0x7ff) as i32;
    let mantissa = (bits & ((1u64 << 52) - 1)) | if encoded_exponent == 0 { 0 } else { 1u64 << 52 };
    let binary_exponent = if encoded_exponent == 0 {
        -1074
    } else {
        encoded_exponent - 1023 - 52
    };
    let common_exponent = binary_exponent.min(exponent);
    let mut binary = Natural::new(mantissa);
    for _ in 0..(-exponent).max(0) {
        binary.times_five();
    }
    let binary = binary.shifted((binary_exponent - common_exponent) as usize);
    let distance = |candidate| {
        let mut decimal = Natural::new(candidate);
        for _ in 0..exponent.max(0) {
            decimal.times_five();
        }
        binary.distance(&decimal.shifted((exponent - common_exponent) as usize))
    };
    let length = |candidate: u64| candidate.to_string().trim_end_matches('0').len();
    let mut best = coefficient;
    let mut best_distance = distance(best);
    for candidate in [coefficient - 1, coefficient + 1] {
        if candidate == 0
            || format!("{candidate}e{exponent}")
                .parse::<f64>()
                .ok()
                .map(f64::to_bits)
                != Some(bits)
        {
            continue;
        }
        let candidate_distance = distance(candidate);
        let priority = length(candidate)
            .cmp(&length(best))
            .then_with(|| candidate_distance.compare(&best_distance));
        if priority.is_lt() || priority.is_eq() && candidate % 2 == 0 && best % 2 != 0 {
            best = candidate;
            best_distance = candidate_distance;
        }
    }
    best
}

// Keep shortest round-trip digits, using JSON.stringify's decimal placement for
// positions below 1e-6 and canonical ties independent of request number syntax.
pub(crate) fn js_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let negative = value < 0.0;
    let encoded = serde_json::to_string(&value.abs()).expect("position is finite");
    let (coefficient, exponent) = encoded
        .split_once('e')
        .map_or((encoded.as_str(), 0), |(left, right)| {
            (left, right.parse::<i32>().expect("JSON exponent"))
        });
    let decimal = coefficient.find('.').unwrap_or(coefficient.len()) as i32;
    let digits: String = coefficient
        .chars()
        .filter(|character| *character != '.')
        .collect();
    let leading = digits.bytes().take_while(|byte| *byte == b'0').count();
    let digits = digits[leading..].trim_end_matches('0');
    let initial_point = decimal + exponent - leading as i32;
    let exponent = initial_point - digits.len() as i32;
    let chosen = canonical_significand(
        value.abs(),
        digits.parse().expect("finite coefficient"),
        exponent,
    )
    .to_string();
    let point = chosen.len() as i32 + exponent;
    let digits = chosen.trim_end_matches('0');
    let mut result = if negative {
        "-".to_owned()
    } else {
        String::new()
    };
    if value.abs() < 1e-6 {
        result.push(digits.as_bytes()[0] as char);
        if digits.len() > 1 {
            result.push('.');
            result.push_str(&digits[1..]);
        }
        result.push('e');
        result.push_str(&(point - 1).to_string());
    } else if point <= 0 {
        result.push_str("0.");
        result.extend(std::iter::repeat_n('0', (-point) as usize));
        result.push_str(digits);
    } else if point as usize >= digits.len() {
        result.push_str(digits);
        result.extend(std::iter::repeat_n('0', point as usize - digits.len()));
    } else {
        result.push_str(&digits[..point as usize]);
        result.push('.');
        result.push_str(&digits[point as usize..]);
    }
    result
}

struct Edit {
    span: Range<usize>,
    value: String,
    path: String,
}
fn patch(
    scene: &Scene<'_>,
    content: &str,
    changes: &Value,
) -> Result<SceneSourceResponse, CoreError> {
    let changes = changes.as_array().ok_or_else(invalid)?;
    if changes.len() > scene.actors.len() {
        return Err(invalid());
    }
    let by_id: HashMap<_, _> = scene
        .actors
        .iter()
        .enumerate()
        .map(|(index, actor)| (actor.identity.as_str(), (index, actor)))
        .collect();
    let mut seen = HashSet::new();
    let mut edits = Vec::new();
    for change in changes {
        let change = change
            .as_object()
            .filter(|change| {
                change.len() == 2
                    && change.contains_key("objectId")
                    && change.contains_key("position")
            })
            .ok_or_else(invalid)?;
        let id = change["objectId"].as_str().ok_or_else(invalid)?;
        if !seen.insert(id) {
            return Err(invalid());
        }
        let (index, actor) = by_id.get(id).ok_or_else(invalid)?;
        let position = change["position"]
            .as_array()
            .filter(|pair| pair.len() == 2)
            .ok_or_else(invalid)?;
        let axes = actor.value.require("position")?.array()?;
        for axis in 0..2 {
            let number = position[axis]
                .as_f64()
                .filter(|number| number.is_finite() && number.abs() <= 100_000.0)
                .ok_or_else(invalid)?;
            if number != actor.position[axis] {
                edits.push(Edit {
                    span: axes[axis].span.clone(),
                    value: js_number(number),
                    path: format!("/actors/{index}/position/{axis}"),
                });
            }
        }
    }
    edits.sort_by_key(|edit| edit.span.start);
    let mut output = String::with_capacity(content.len());
    let mut cursor = 0;
    for edit in &edits {
        output.push_str(&content[cursor..edit.span.start]);
        output.push_str(&edit.value);
        cursor = edit.span.end;
    }
    output.push_str(&content[cursor..]);
    if output.len() > MAX_BYTES {
        return Err(content_limit());
    }
    Ok(SceneSourceResponse::Patch {
        after_content: output,
        changed_paths: edits.into_iter().map(|edit| edit.path).collect(),
    })
}

pub(crate) fn dispatch(operation: &str, request: &Value) -> Result<SceneSourceResponse, CoreError> {
    let fields = request.as_object().ok_or_else(invalid)?;
    let expected = if operation == "sceneSource.patch" {
        4
    } else {
        3
    };
    if fields.len() != expected
        || !fields.contains_key("protocolVersion")
        || !fields.contains_key("operation")
        || !fields.contains_key("content")
        || expected == 4 && !fields.contains_key("changes")
    {
        return Err(invalid());
    }
    let content = request["content"].as_str().ok_or_else(invalid)?;
    let root = Scanner::parse(content)?;
    let scene = validate(&root, content)?;
    if operation == "sceneSource.inspect" {
        Ok(SceneSourceResponse::Inspect {
            schema_version: scene.version,
            actor_count: scene.actors.len(),
        })
    } else {
        patch(&scene, content, &request["changes"])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FIRST: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const SECOND: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const GROUP: &str = "33333333-3333-4333-8333-333333333333";
    fn fixture(version: u8) -> Value {
        let mut actors = vec![
            json!({"objectId":FIRST,"position":[100,0],"useProjectionDefaults":true,"imageResourceId":null}),
            json!({"objectId":if version == 1 {SECOND} else {FIRST},"position":[300,200],"speed":120}),
        ];
        if version >= 2 {
            actors[0]["instanceId"] = json!(FIRST);
            actors[1]["instanceId"] = json!(SECOND);
        }
        let mut scene = json!({"format":"viento-scene2d","schemaVersion":version,"title":"町😀","actors":actors});
        if version == 3 {
            scene["groups"] = json!([{ "groupId": GROUP, "name": "Town" }]);
            scene["actors"][1]["groupId"] = json!(GROUP);
        }
        scene
    }
    fn request(operation: &str, content: &str, changes: Option<Value>) -> Value {
        let mut request = json!({"protocolVersion":1,"operation":operation,"content":content});
        if let Some(changes) = changes {
            request["changes"] = changes;
        }
        serde_json::from_slice(&crate::dispatch_json(
            &serde_json::to_vec(&request).unwrap(),
        ))
        .unwrap()
    }
    fn inspect(content: &str) -> Value {
        request("sceneSource.inspect", content, None)
    }
    fn change(id: &str, x: f64, y: f64) -> Value {
        json!({"objectId":id,"position":[x,y]})
    }
    fn error(response: &Value, code: &str) {
        assert_eq!(response["ok"], false, "{response}");
        assert_eq!(response["errorCode"], code);
    }
    fn invalid_source(content: &str) {
        error(&inspect(content), "scene_source_layout_invalid");
    }

    #[test]
    fn inspect_versions_and_optional_feature_probe() {
        assert_eq!(crate::viento_core_scene_source_version(), 1);
        assert_eq!(crate::PROTOCOL_VERSION, 1);
        for version in 1..=3 {
            let result = inspect(&fixture(version).to_string());
            assert_eq!(
                result,
                json!({"protocolVersion":1,"ok":true,"source":{"schemaVersion":version,"actorCount":2}})
            );
        }
    }
    #[test]
    fn exact_requests_and_batch_shapes_are_required() {
        let content = fixture(2).to_string();
        let ordinary =
            json!({"protocolVersion":1,"operation":"sceneSource.inspect","content":content});
        for request in [
            json!({"protocolVersion":1,"operation":"sceneSource.inspect"}),
            json!({"protocolVersion":1,"operation":"sceneSource.inspect","content":7}),
            json!({"protocolVersion":1,"operation":"sceneSource.inspect","content":content,"changes":[]}),
            json!({"protocolVersion":1,"operation":"sceneSource.inspect","content":content,"extra":true}),
            json!({"protocolVersion":1,"operation":"sceneSource.patch","content":content}),
            json!({"protocolVersion":1,"operation":"sceneSource.patch","content":content,"other":[]}),
        ] {
            let result: Value = serde_json::from_slice(&crate::dispatch_json(
                &serde_json::to_vec(&request).unwrap(),
            ))
            .unwrap();
            error(&result, "scene_source_layout_invalid");
        }
        assert_eq!(ordinary["operation"], "sceneSource.inspect");
        for changes in [
            json!(null),
            json!({}),
            json!([null]),
            json!([{"objectId": FIRST,"position":[1,2],"other":1}]),
            json!([{"objectId": FIRST,"position":[1]}]),
            json!([{"objectId": FIRST,"position":[1,2,3]}]),
            json!([{"objectId": FIRST,"position":["1",2]}]),
            json!([{"objectId": GROUP,"position":[1,2]}]),
            json!([change(FIRST, 1.0, 2.0), change(FIRST, 2.0, 3.0)]),
            json!([change(FIRST, 100001.0, 0.0)]),
            json!([
                change(FIRST, 0.0, 0.0),
                change(SECOND, 0.0, 0.0),
                change(GROUP, 0.0, 0.0)
            ]),
        ] {
            error(
                &request("sceneSource.patch", &content, Some(changes)),
                "scene_source_layout_invalid",
            );
        }
    }
    #[test]
    fn lossless_patches_keep_bom_crlf_numeric_spelling_and_unknown_values() {
        for version in 1..=3 {
            let source = format!(
                "\u{feff}{}\r\n",
                serde_json::to_string_pretty(&fixture(version))
                    .unwrap()
                    .replace("100,", "1e2,")
                    .replace("120", "1.2e2")
                    .replace("      0\n", "      -0\n")
                    .replace('\n', "\r\n")
            );
            let result = request(
                "sceneSource.patch",
                &source,
                Some(json!([change(SECOND, 350.5, 200.0)])),
            );
            assert_eq!(
                result["source"]["afterContent"],
                source.replace("300,", "350.5,")
            );
            assert_eq!(
                result["source"]["changedPaths"],
                json!(["/actors/1/position/0"])
            );
            assert_eq!(
                request(
                    "sceneSource.patch",
                    &source,
                    Some(json!([change(FIRST, 100.0, -0.0)]))
                )["source"]["afterContent"],
                source
            );
        }
    }
    #[test]
    fn paths_follow_source_order_and_decoded_position_keys_preserve_their_spelling() {
        let source = fixture(2)
            .to_string()
            .replace("\"position\"", "\"posit\\u0069on\"");
        let result = request(
            "sceneSource.patch",
            &source,
            Some(json!([
                change(SECOND, 350.0, 250.0),
                change(FIRST, 110.0, 10.0)
            ])),
        );
        assert_eq!(
            result["source"]["changedPaths"],
            json!([
                "/actors/0/position/0",
                "/actors/0/position/1",
                "/actors/1/position/0",
                "/actors/1/position/1"
            ])
        );
        assert_eq!(
            result["source"]["afterContent"],
            source
                .replace("[100,0]", "[110,10]")
                .replace("[300,200]", "[350,250]")
        );
    }
    #[test]
    fn strict_syntax_and_duplicate_decoded_keys_are_checked_throughout_unknown_subtrees() {
        for bad in [
            "",
            "null",
            "[]",
            "{}",
            "\u{feff}\u{feff}{}",
            "{\"x\":1,}",
            "{\"x\":+1}",
            "{\"x\":01}",
            "{\"x\":.1}",
            "{\"x\":1.}",
            "{\"x\":1e}",
            "{\"x\":tru}",
            "{\"x\":\"\\x20\"}",
            "{\"x\":\"\\u000\"}",
            "{\"x\":\"\n\"}",
            "{\"x\":[1,]}",
            "{\"x\":false true}",
        ] {
            invalid_source(bad);
        }
        let source = fixture(1).to_string();
        for extra in [
            r#""x":{"a":1,"\u0061":2}"#,
            r#""x":[{"😀":0,"\ud83d\ude00":1}]"#,
            r#""x":{"\ud800":0,"\ud800":1}"#,
            r#""x":{"a/b":0,"a\/b":1}"#,
        ] {
            invalid_source(&source.replacen('{', &format!("{{{extra},"), 1));
        }
    }
    #[test]
    fn unknown_numbers_and_escaped_lone_surrogates_are_never_interpreted_or_normalized() {
        let source = fixture(1).to_string().replacen('{', r#"{"extra":{"high":1e400,"low":1e-9999,"int":1234567890123456789012345678901234567890,"\ud800":"\udfff"},"#, 1);
        assert_eq!(inspect(&source)["ok"], true);
        assert_eq!(
            request(
                "sceneSource.patch",
                &source,
                Some(json!([change(FIRST, 101.0, 0.0)]))
            )["source"]["afterContent"],
            source.replace("[100,0]", "[101,0]")
        );
        let source = fixture(3).to_string().replace("\"Town\"", "\"\\ud800\"");
        assert_eq!(inspect(&source)["ok"], true);
        assert_eq!(
            inspect(
                &fixture(1)
                    .to_string()
                    .replace("\"schemaVersion\":1", "\"schemaVersion\":1.0e0")
            )["ok"],
            true
        );
        assert_eq!(
            inspect(
                &fixture(1)
                    .to_string()
                    .replace("[100,0]", "[1e-9999,-0.000e+3]")
            )["ok"],
            true
        );
        invalid_source(&fixture(1).to_string().replace("[100,0]", "[1e400,0]"));
    }
    #[test]
    fn source_geometry_and_identity_limits_match_all_three_versions() {
        for version in 1..=3 {
            for field in ["format", "schemaVersion", "actors"] {
                let mut scene = fixture(version);
                scene.as_object_mut().unwrap().remove(field);
                invalid_source(&scene.to_string());
            }
            for position in [
                json!([null, 0]),
                json!(["1", 0]),
                json!([1]),
                json!([1, 2, 3]),
                json!([100001, 0]),
                json!([0, -100001]),
            ] {
                let mut scene = fixture(version);
                scene["actors"][0]["position"] = position;
                invalid_source(&scene.to_string());
            }
            let mut scene = fixture(version);
            scene["actors"][0]["objectId"] = json!(FIRST.to_uppercase());
            invalid_source(&scene.to_string());
            let mut scene = fixture(version);
            let key = if version == 1 {
                "objectId"
            } else {
                "instanceId"
            };
            scene["actors"][1][key] = json!(FIRST);
            invalid_source(&scene.to_string());
            let mut scene = fixture(version);
            scene["actors"] = json!([]);
            invalid_source(&scene.to_string());
        }
        let mut scene = fixture(1);
        scene["actors"][0]["instanceId"] = json!(FIRST);
        invalid_source(&scene.to_string());
        for version in [1, 2] {
            let mut scene = fixture(version);
            scene["groups"] = json!([]);
            invalid_source(&scene.to_string());
            let mut scene = fixture(version);
            scene["actors"][0]["groupId"] = Value::Null;
            invalid_source(&scene.to_string());
        }
        let mut scene = fixture(2);
        scene["actors"] = Value::Array((1..=128).map(|index| json!({"objectId":FIRST,"instanceId":format!("{index:08x}-1111-4111-8111-111111111111"),"position":[0,0]})).collect());
        assert_eq!(inspect(&scene.to_string())["source"]["actorCount"], 128);
        scene["actors"]
            .as_array_mut()
            .unwrap()
            .push(json!({"objectId":SECOND,"instanceId":SECOND,"position":[0,0]}));
        invalid_source(&scene.to_string());
    }
    #[test]
    fn group_names_use_utf16_units_and_ecmascript_whitespace() {
        for accepted in [
            "😀".repeat(80),
            "x".repeat(160),
            "\u{85}".into(),
            "\u{feff}x\u{feff}".into(),
        ] {
            let mut scene = fixture(3);
            scene["groups"][0]["name"] = json!(accepted);
            assert_eq!(inspect(&scene.to_string())["ok"], true);
        }
        for rejected in [
            "😀".repeat(81),
            "x".repeat(161),
            String::new(),
            " \u{feff}\u{2000}\u{2028}".into(),
            "x\t".into(),
            "x\u{7f}".into(),
        ] {
            let mut scene = fixture(3);
            scene["groups"][0]["name"] = json!(rejected);
            invalid_source(&scene.to_string());
        }
    }
    #[test]
    fn group_identity_parent_topology_and_membership_are_bounded() {
        for groups in [
            json!(null),
            json!([null]),
            json!([{"groupId":GROUP,"name":"A","unknown":true}]),
            json!([{"groupId":GROUP,"name":"A","parentGroupId":null}]),
            json!([{"groupId":GROUP,"name":"A","parentGroupId":GROUP}]),
            json!([{"groupId":GROUP,"name":"A","parentGroupId":SECOND}]),
            json!([{"groupId":FIRST,"name":"A"}]),
            json!([{"groupId":GROUP,"name":"A"},{"groupId":GROUP,"name":"B"}]),
            json!([{"groupId":GROUP,"name":"A","parentGroupId":SECOND},{"groupId":SECOND,"name":"B","parentGroupId":GROUP}]),
        ] {
            let mut scene = fixture(3);
            scene["groups"] = groups;
            invalid_source(&scene.to_string());
        }
        let mut scene = fixture(3);
        scene["actors"][1]["groupId"] = json!(FIRST);
        invalid_source(&scene.to_string());
        let mut scene = fixture(3);
        scene["actors"][1]
            .as_object_mut()
            .unwrap()
            .remove("groupId");
        scene["groups"] = json!([]);
        assert_eq!(inspect(&scene.to_string())["ok"], true);
        let id = |index| format!("{index:08x}-1111-4111-8111-111111111111");
        let chain = |length| {
            Value::Array(
                (1..=length)
                    .map(|index| {
                        let mut group =
                            json!({"groupId":id(index),"name":"Repeated names are allowed"});
                        if index > 1 {
                            group["parentGroupId"] = json!(id(index - 1));
                        }
                        group
                    })
                    .collect(),
            )
        };
        scene["groups"] = chain(16);
        assert_eq!(inspect(&scene.to_string())["ok"], true);
        scene["groups"] = chain(17);
        invalid_source(&scene.to_string());
        scene["groups"] = Value::Array(
            (1..=128)
                .map(|index| json!({"groupId":id(index),"name":"Root"}))
                .collect(),
        );
        assert_eq!(inspect(&scene.to_string())["ok"], true);
        scene["groups"]
            .as_array_mut()
            .unwrap()
            .push(json!({"groupId":GROUP,"name":"Overflow"}));
        invalid_source(&scene.to_string());
    }
    #[test]
    fn byte_limits_apply_before_parsing_and_after_coordinate_growth() {
        let source = fixture(1).to_string();
        let exact = source.clone() + &" ".repeat(MAX_BYTES - source.len());
        assert_eq!(inspect(&exact)["ok"], true);
        error(
            &inspect(&(exact.clone() + " ")),
            "scene_source_layout_content_limit",
        );
        error(
            &request(
                "sceneSource.patch",
                &exact,
                Some(json!([change(FIRST, 100000.0, 0.0)])),
            ),
            "scene_source_layout_content_limit",
        );
        let mut scene = fixture(1);
        scene["title"] = json!("町".repeat(MAX_BYTES / 3));
        error(
            &inspect(&scene.to_string()),
            "scene_source_layout_content_limit",
        );
    }
    #[test]
    fn structural_depth_budget_includes_unknown_subtrees_and_empty_containers() {
        let source = fixture(1).to_string();
        let nested = |depth| format!("{}0{}", "[".repeat(depth), "]".repeat(depth));
        assert_eq!(
            inspect(&source.replacen('{', &format!("{{\"unknown\":{},", nested(63)), 1))["ok"],
            true
        );
        invalid_source(&source.replacen('{', &format!("{{\"unknown\":{},", nested(64)), 1));
        assert!(Scanner::parse(&("[".repeat(65) + &"]".repeat(65))).is_ok());
        assert!(Scanner::parse(&("[".repeat(66) + &"]".repeat(66))).is_err());
    }
    #[test]
    fn decimal_output_matches_javascript_thresholds_subnormals_and_exact_even_ties() {
        for (value, expected) in [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (100000.0, "100000"),
            (-100000.0, "-100000"),
            (0.000001, "0.000001"),
            (0.0000001, "1e-7"),
            (-0.0000001, "-1e-7"),
            (f64::from_bits(1), "5e-324"),
            (2.9802322387695312e-8, "2.9802322387695312e-8"),
            (3.725290298461914e-9, "3.725290298461914e-9"),
            (0.1, "0.1"),
            (0.30000000000000004, "0.30000000000000004"),
            (99999.99999999999, "99999.99999999999"),
        ] {
            assert_eq!(js_number(value), expected);
            assert_eq!(expected.parse::<f64>().unwrap(), value);
        }
        let source = fixture(1).to_string();
        let raw = format!(
            r#"{{"protocolVersion":1,"operation":"sceneSource.patch","content":{},"changes":[{{"objectId":"{}","position":[1.00,1e-6]}}]}}"#,
            serde_json::to_string(&source).unwrap(),
            FIRST
        );
        let result: Value = serde_json::from_slice(&crate::dispatch_json(raw.as_bytes())).unwrap();
        assert_eq!(
            result["source"]["afterContent"],
            source.replace("[100,0]", "[1,0.000001]")
        );
    }
}
