// One reversible transformation to a generated motor copy. The historical
// movement template and its frozen generator remain unchanged.
const invalid = () => { throw new TypeError('Invalid generated character intent hook.'); };
const replacements = [
  ['\t\t\t\tvelocity.x = horizontal * actor["speed"] if actor["controls"] == "arrows" else 0.0', '\t\t\t\tvar character_intent: Dictionary = get("movement_contacts").intent.take(instance_id)\n\t\t\t\tvelocity.x = horizontal * actor["speed"] if actor["controls"] == "arrows" else float(character_intent["axis"]) * actor["speed"]'],
  ['\t\t\t\tif jump_pressed and actor["controls"] == "arrows" and character_motion_grounded[instance_id] and motor["jumpSpeed"] > 0.0:', '\t\t\t\tif ((jump_pressed and actor["controls"] == "arrows") or (actor["controls"] == "none" and character_intent["jump"])) and character_motion_grounded[instance_id] and motor["jumpSpeed"] > 0.0:'],
  ['\t\t\t\tnext_state = "moving" if horizontal != 0.0 and actor["controls"] == "arrows" and actor["speed"] > 0 else "idle"', '\t\t\t\tnext_state = "moving" if ((horizontal != 0.0 and actor["controls"] == "arrows") or (actor["controls"] == "none" and float(character_intent["axis"]) != 0.0)) and actor["speed"] > 0 else "idle"'],
];
function replace(source, from, to) {
  if (source.split(from).length !== 2) invalid();
  return source.replace(from, to);
}
export function hookCharacterIntent(source) {
  if (source.includes('character_intent')) invalid();
  return replacements.reduce((text, [before, after]) => replace(text, before, after), source);
}
export function unhookCharacterIntent(source) {
  return replacements.reduceRight((text, [before, after]) => replace(text, after, before), source);
}
