// The commander's physical controls. These ids always refer to real map features.
// A seal is temporary and closes only one doorway, never a whole sector.
export const DOOR_CONTROLS = Object.freeze([
  { id: 'warehouse_east', name: 'warehouse east door', tiles: [[19, 18]] },
  { id: 'warehouse_south', name: 'warehouse south door', tiles: [[10, 24]] },
  { id: 'corridor_south', name: 'corridor south doors', tiles: [[31, 24], [32, 24]] },
  { id: 'barracks_west', name: 'barracks west door', tiles: [[44, 18]] },
  { id: 'barracks_north', name: 'barracks north door', tiles: [[52, 12]] },
  { id: 'lab_east', name: 'lab east doors', tiles: [[43, 6], [43, 7]] },
  { id: 'lab_north', name: 'lab north door', tiles: [[38, 3]] },
]);
export const FLOODLIGHTS = Object.freeze([
  { id: 'warehouse', name: 'warehouse floodlights', x: 10, y: 18, r: 7 },
  { id: 'checkpoint', name: 'checkpoint floodlights', x: 31.5, y: 28, r: 8 },
  { id: 'yard_e', name: 'east-yard floodlights', x: 52, y: 27, r: 8 },
  { id: 'bunks', name: 'barracks floodlights', x: 50, y: 18, r: 7 },
  { id: 'lab', name: 'research-lab floodlights', x: 35, y: 8, r: 8 },
  { id: 'helipad', name: 'helipad floodlights', x: 54, y: 7, r: 9 },
]);
export const SEAL_SECONDS = 10;
export const FIELD_SECONDS = 20;
