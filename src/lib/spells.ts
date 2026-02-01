// SRD 5.1 Spell List - OGL 1.0a Compliant
// This list contains only spells from the System Reference Document 5.1
// Source: https://dnd.wizards.com/resources/systems-reference-document

export type SpellLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type SpellSchool =
  | 'abjuration'
  | 'conjuration'
  | 'divination'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation';

export interface Spell {
  name: string;
  level: SpellLevel;
  school: SpellSchool;
  castingTime: string;
  range: string;
  components: {
    verbal: boolean;
    somatic: boolean;
    material?: string;
  };
  duration: string;
  description: string;
  higherLevels?: string;
  ritual?: boolean;
  concentration?: boolean;
}

// SRD Cantrips (0-level spells)
export const SRD_CANTRIPS: Spell[] = [
  {
    name: 'Blade Ward',
    level: 0,
    school: 'abjuration',
    castingTime: '1 action',
    range: 'Self',
    components: { verbal: true, somatic: true },
    duration: '1 round',
    description: 'You extend your hand and trace a sigil of warding in the air. Until the end of your next turn, you have resistance against bludgeoning, piercing, and slashing damage dealt by weapon attacks.',
  },
  {
    name: 'Dancing Lights',
    level: 0,
    school: 'evocation',
    castingTime: '1 action',
    range: '120 feet',
    components: { verbal: true, somatic: true, material: 'a bit of phosphorus or wychwood, or a glowworm' },
    duration: 'Concentration, up to 1 minute',
    description: 'You create up to four torch-sized lights within range, making them appear as torches, lanterns, or glowing orbs that hover in the air for the duration.',
    concentration: true,
  },
  {
    name: 'Friends',
    level: 0,
    school: 'enchantment',
    castingTime: '1 action',
    range: 'Self',
    components: { verbal: true, somatic: true, material: 'a small amount of makeup applied to the face as this spell is cast' },
    duration: 'Concentration, up to 1 minute',
    description: 'For the duration, you have advantage on all Charisma checks directed at one creature of your choice that isn\'t hostile toward you.',
    concentration: true,
  },
  {
    name: 'Guidance',
    level: 0,
    school: 'divination',
    castingTime: '1 action',
    range: 'Touch',
    components: { verbal: true, somatic: true },
    duration: 'Concentration, up to 1 minute',
    description: 'You touch one willing creature. Once before the spell ends, the target can roll a d4 and add the number rolled to one ability check of its choice.',
    concentration: true,
  },
  {
    name: 'Light',
    level: 0,
    school: 'evocation',
    castingTime: '1 action',
    range: 'Touch',
    components: { verbal: true, material: 'a firefly or phosphorescent moss' },
    duration: '1 hour',
    description: 'You touch one object that is no larger than 10 feet in any dimension. Until the spell ends, the object sheds bright light in a 20-foot radius and dim light for an additional 20 feet.',
  },
  {
    name: 'Mage Hand',
    level: 0,
    school: 'conjuration',
    castingTime: '1 action',
    range: '30 feet',
    components: { verbal: true, somatic: true },
    duration: '1 minute',
    description: 'A spectral, floating hand appears at a point you choose within range. The hand lasts for the duration or until you dismiss it as an action.',
  },
  {
    name: 'Mending',
    level: 0,
    school: 'transmutation',
    castingTime: '1 minute',
    range: 'Touch',
    components: { verbal: true, somatic: true, material: 'two lodestones' },
    duration: 'Instantaneous',
    description: 'This spell repairs a single break or tear in an object you touch, such as a broken chain link, two halves of a broken key, a torn cloak, or a leaking wineskin.',
  },
  {
    name: 'Message',
    level: 0,
    school: 'transmutation',
    castingTime: '1 action',
    range: '120 feet',
    components: { verbal: true, somatic: true, material: 'a short piece of copper wire' },
    duration: '1 round',
    description: 'You point your finger toward a creature within range and whisper a message. The target (and only the target) hears the message and can reply in a whisper that only you can hear.',
  },
  {
    name: 'Minor Illusion',
    level: 0,
    school: 'illusion',
    castingTime: '1 action',
    range: '30 feet',
    components: { verbal: false, somatic: true, material: 'a bit of fleece' },
    duration: '1 minute',
    description: 'You create a sound or an image of an object within range that lasts for the duration.',
  },
  {
    name: 'Poison Spray',
    level: 0,
    school: 'conjuration',
    castingTime: '1 action',
    range: '10 feet',
    components: { verbal: true, somatic: true },
    duration: 'Instantaneous',
    description: 'You extend your hand toward a creature within range and project a puff of noxious gas from your palm. The creature must succeed on a Constitution saving throw or take 1d12 poison damage.',
  },
  {
    name: 'Prestidigitation',
    level: 0,
    school: 'transmutation',
    castingTime: '1 action',
    range: '10 feet',
    components: { verbal: true, somatic: true },
    duration: 'Up to 1 hour',
    description: 'This spell is a minor magical trick that novice spellcasters use for practice.',
  },
  {
    name: 'Ray of Frost',
    level: 0,
    school: 'evocation',
    castingTime: '1 action',
    range: '60 feet',
    components: { verbal: true, somatic: true },
    duration: 'Instantaneous',
    description: 'A frigid beam of blue-white light streaks toward a creature within range. Make a ranged spell attack against the target. On a hit, it takes 1d8 cold damage, and its speed is reduced by 10 feet until the start of your next turn.',
  },
  {
    name: 'Resistance',
    level: 0,
    school: 'abjuration',
    castingTime: '1 action',
    range: 'Touch',
    components: { verbal: true, somatic: true },
    duration: 'Concentration, up to 1 minute',
    description: 'You touch one willing creature. Once before the spell ends, the target can roll a d4 and add the number rolled to one saving throw of its choice.',
    concentration: true,
  },
  {
    name: 'Sacred Flame',
    level: 0,
    school: 'evocation',
    castingTime: '1 action',
    range: '60 feet',
    components: { verbal: true, somatic: true },
    duration: 'Instantaneous',
    description: 'Flame-like radiance descends on a creature that you can see within range. The target must succeed on a Dexterity saving throw or take 1d8 radiant damage.',
  },
  {
    name: 'Shocking Grasp',
    level: 0,
    school: 'evocation',
    castingTime: '1 action',
    range: 'Touch',
    components: { verbal: true, somatic: true },
    duration: 'Instantaneous',
    description: 'Lightning springs from your hand to deliver a shock to a creature you try to touch. Make a melee spell attack against the target. On a hit, the target takes 1d8 lightning damage, and it can\'t take reactions until the start of its next turn.',
  },
  {
    name: 'Spare the Dying',
    level: 0,
    school: 'necromancy',
    castingTime: '1 action',
    range: 'Touch',
    components: { verbal: true, somatic: true },
    duration: 'Instantaneous',
    description: 'You touch a living creature that has 0 hit points. The creature becomes stable.',
  },
  {
    name: 'Thaumaturgy',
    level: 0,
    school: 'transmutation',
    castingTime: '1 action',
    range: '30 feet',
    components: { verbal: true },
    duration: 'Up to 1 minute',
    description: 'You manifest a minor wonder, a sign of supernatural power, within range.',
  },
  {
    name: 'True Strike',
    level: 0,
    school: 'divination',
    castingTime: '1 action',
    range: '30 feet',
    components: { verbal: false, somatic: true },
    duration: 'Concentration, up to 1 round',
    description: 'You extend your hand and point a finger at a target in range. Your magic grants you a brief insight into the target\'s defenses. On your next turn, you gain advantage on your first attack roll against the target.',
    concentration: true,
  },
  {
    name: 'Vicious Mockery',
    level: 0,
    school: 'enchantment',
    castingTime: '1 action',
    range: '60 feet',
    components: { verbal: true },
    duration: 'Instantaneous',
    description: 'You unleash a string of insults laced with subtle enchantments at a creature you can see within range. If the target can hear you (though it need not understand you), it must succeed on a Wisdom saving throw or take 1d4 psychic damage and have disadvantage on the next attack roll it makes before the end of its next turn.',
  },
];

// SRD 1st-Level Spells (sample - full list would be much longer)
export const SRD_1ST_LEVEL: Spell[] = [
  {
    name: 'Burning Hands',
    level: 1,
    school: 'evocation',
    castingTime: '1 action',
    range: 'Self (15-foot cone)',
    components: { verbal: true, somatic: true },
    duration: 'Instantaneous',
    description: 'As you hold your hands with thumbs touching and fingers spread, a thin sheet of flames shoots forth from your outstretched fingertips. Each creature in a 15-foot cone must make a Dexterity saving throw.',
    higherLevels: 'When you cast this spell using a spell slot of 2nd level or higher, the damage increases by 1d6 for each slot level above 1st.',
  },
  {
    name: 'Cure Wounds',
    level: 1,
    school: 'evocation',
    castingTime: '1 action',
    range: 'Touch',
    components: { verbal: true, somatic: true },
    duration: 'Instantaneous',
    description: 'A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.',
    higherLevels: 'When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d8 for each slot level above 1st.',
  },
  {
    name: 'Detect Magic',
    level: 1,
    school: 'divination',
    castingTime: '1 action',
    range: 'Self',
    components: { verbal: true, somatic: true },
    duration: 'Concentration, up to 10 minutes',
    description: 'For the duration, you sense the presence of magic within 30 feet of you.',
    ritual: true,
    concentration: true,
  },
  {
    name: 'Magic Missile',
    level: 1,
    school: 'evocation',
    castingTime: '1 action',
    range: '120 feet',
    components: { verbal: true, somatic: true },
    duration: 'Instantaneous',
    description: 'You create three glowing darts of magical force. Each dart hits a creature of your choice that you can see within range. A dart deals 1d4+1 force damage to its target.',
    higherLevels: 'When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.',
  },
  {
    name: 'Shield',
    level: 1,
    school: 'abjuration',
    castingTime: '1 reaction, which you take when you are hit by an attack or targeted by the magic missile spell',
    range: 'Self',
    components: { verbal: true, somatic: true },
    duration: '1 round',
    description: 'An invisible barrier of magical force appears and protects you. Until the start of your next turn, you have a +5 bonus to AC, including against the triggering attack, and you take no damage from magic missile.',
  },
];

// Combine all SRD spells
export const SRD_SPELLS: Spell[] = [...SRD_CANTRIPS, ...SRD_1ST_LEVEL];

// Helper functions
export function getSpellsByLevel(level: SpellLevel): Spell[] {
  return SRD_SPELLS.filter((s) => s.level === level);
}

export function getSpellByName(name: string): Spell | undefined {
  return SRD_SPELLS.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export function isSRDSpell(name: string): boolean {
  return getSpellByName(name) !== undefined;
}

