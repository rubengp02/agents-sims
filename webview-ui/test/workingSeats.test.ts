import { describe, expect, it } from 'vitest';

import { createCharacter, updateCharacter } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { CharacterState, Direction, type Seat, TileType } from '../src/office/types.js';

const chair = (col: number, row: number, assigned = true): Seat => ({
  seatCol: col,
  seatRow: row,
  facingDir: Direction.UP,
  assigned,
  uid: 'desk',
});
const floor = (): TileType[][] =>
  Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => TileType.FLOOR_1));

describe('working characters return to actual available seats', () => {
  it('does not type at an unreachable desk from the corridor', () => {
    const seat = chair(3, 3);
    const ch = createCharacter(1, 0, 'desk', seat);
    ch.tileCol = 0;
    ch.tileRow = 0;
    ch.state = CharacterState.IDLE;
    const map = floor();
    map[2][3] = TileType.WALL;
    map[4][3] = TileType.WALL;
    map[3][2] = TileType.WALL;
    map[3][4] = TileType.WALL;
    updateCharacter(ch, 0.1, [], new Map([['desk', seat]]), map, new Set());
    expect(ch.state).toBe(CharacterState.IDLE);
    expect([ch.tileCol, ch.tileRow]).toEqual([0, 0]);
  });
  it('walks back before starting the typing animation', () => {
    const seat = chair(2, 2);
    const ch = createCharacter(1, 0, 'desk', seat);
    ch.tileCol = 0;
    ch.tileRow = 0;
    const seats = new Map([['desk', seat]]);
    updateCharacter(ch, 0.1, [], seats, floor(), new Set());
    expect(ch.state).toBe(CharacterState.IDLE);
    updateCharacter(ch, 0.1, [], seats, floor(), new Set());
    expect(ch.state).toBe(CharacterState.WALK);
    for (let index = 0; index < 100; index++)
      updateCharacter(ch, 0.1, [], seats, floor(), new Set());
    expect(ch.state).toBe(CharacterState.TYPE);
    expect([ch.tileCol, ch.tileRow]).toEqual([2, 2]);
  });
  it('does not show a seated typing pose for a seatless top-level worker', () => {
    const ch = createCharacter(1, 0, null, null);
    updateCharacter(ch, 0.1, [], new Map(), floor(), new Set());
    updateCharacter(ch, 0.1, [], new Map(), floor(), new Set());
    expect(ch.state).toBe(CharacterState.IDLE);
  });
  it('retains the existing seatless subagent animation', () => {
    const ch = createCharacter(-1, 0, null, null);
    ch.isSubagent = true;
    updateCharacter(ch, 0.1, [], new Map(), floor(), new Set());
    expect(ch.state).toBe(CharacterState.TYPE);
  });
  it('preserves the original reservation if a requested destination is already occupied', () => {
    const office = new OfficeState();
    office.seats = new Map([
      ['own', chair(1, 1)],
      ['other', chair(2, 2)],
    ]);
    office.characters.set(1, createCharacter(1, 0, 'own', office.seats.get('own')!));
    office.reassignSeat(1, 'other');
    expect(office.characters.get(1)?.seatId).toBe('own');
    expect(office.seats.get('own')?.assigned).toBe(true);
  });
  it('assigns a newly freed desk to a waiting seatless worker', () => {
    const office = new OfficeState();
    office.tileMap = floor();
    office.blockedTiles = new Set();
    office.walkableTiles = [];
    office.seats = new Map([['desk', chair(2, 2)]]);
    const ch = createCharacter(1, 0, null, null);
    office.characters.set(1, ch);
    office.update(0.1);
    expect(ch.seatId).toBeNull();
    office.seats.get('desk')!.assigned = false;
    office.update(0.1);
    expect(ch.seatId).toBe('desk');
    expect(office.seats.get('desk')?.assigned).toBe(true);
  });
});
