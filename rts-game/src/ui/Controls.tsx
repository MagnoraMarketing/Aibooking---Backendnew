const CONTROLS: [string, string][] = [
  ["Left click / drag", "Select squads or a building"],
  ["Shift + click", "Add to / remove from selection"],
  ["Double-click", "Select all squads of that type on screen"],
  ["Right click", "Move, attack target, or set rally point"],
  ["Arrows / screen edge", "Scroll the map (middle-drag also works)"],
  ["Mouse wheel", "Zoom"],
  ["R / M", "Recruit Rifle Squad / MG Team"],
  ["B", "Build Barracks"],
  ["E / S", "Reinforce / Stop"],
  ["H / Space", "Select HQ / centre on selection"],
  ["Ctrl+1–9, 1–9", "Assign / recall control group"],
  ["Esc", "Deselect, then open the menu"],
];

export function Controls() {
  return (
    <dl className="controls">
      {CONTROLS.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
