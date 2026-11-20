// Free-license song library: Kevin MacLeod (incompetech.com), CC-BY.
// Direct mp3 URLs — probed with curl before shipping (see README).
const KM = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/';
const SONGS = [
  { id: 's1',  title: 'Carefree',                    artist: 'Kevin MacLeod', genre: 'Happy pop',      cat: 'Pop',       dur: 205, src: KM + 'Carefree.mp3' },
  { id: 's2',  title: 'Monkeys Spinning Monkeys',    artist: 'Kevin MacLeod', genre: 'Upbeat & fun',   cat: 'Party',     dur: 125, src: KM + 'Monkeys%20Spinning%20Monkeys.mp3' },
  { id: 's3',  title: 'Wallpaper',                    artist: 'Kevin MacLeod', genre: 'Chill',          cat: 'Chill',     dur: 220, src: KM + 'Wallpaper.mp3' },
  { id: 's4',  title: 'Local Forecast',               artist: 'Kevin MacLeod', genre: 'Funk groove',    cat: 'Party',     dur: 165, src: KM + 'Local%20Forecast.mp3' },
  { id: 's5',  title: 'Bossa Antigua',                artist: 'Kevin MacLeod', genre: 'Jazz',           cat: 'Chill',     dur: 283, src: KM + 'Bossa%20Antigua.mp3' },
  { id: 's6',  title: 'Quasi Motion',                 artist: 'Kevin MacLeod', genre: 'Electronic',     cat: 'Pop',       dur: 152, src: KM + 'Quasi%20Motion.mp3' },
  { id: 's7',  title: 'Volatile Reaction',            artist: 'Kevin MacLeod', genre: 'Rock',           cat: 'Rock',      dur: 165, src: KM + 'Volatile%20Reaction.mp3' },
  { id: 's8',  title: 'Corncob',                      artist: 'Kevin MacLeod', genre: 'Country',        cat: 'Country',   dur: 54,  src: KM + 'Corncob.mp3' },
  { id: 's9',  title: 'Heartwarming',                 artist: 'Kevin MacLeod', genre: 'Acoustic piano', cat: 'Feel-good', dur: 72,  src: KM + 'Heartwarming.mp3' },
  { id: 's10', title: 'Gymnopedie No 1',              artist: 'Kevin MacLeod', genre: 'Classical piano',cat: 'Chill',     dur: 187, src: KM + 'Gymnopedie%20No%201.mp3' },
  { id: 's11', title: 'Opportunity Walks',            artist: 'Kevin MacLeod', genre: 'Hip-hop beat',   cat: 'Hip-Hop',   dur: 162, src: KM + 'Opportunity%20Walks.mp3' },
  { id: 's12', title: 'Backed Vibes',                 artist: 'Kevin MacLeod', genre: 'Hip-hop groove', cat: 'Hip-Hop',   dur: 228, src: KM + 'Backed%20Vibes.mp3' },
  { id: 's13', title: 'Vibe Ace',                     artist: 'Kevin MacLeod', genre: 'Jazzy groove',   cat: 'Chill',     dur: 61,  src: KM + 'Vibe%20Ace.mp3' },
  { id: 's14', title: 'Protofunk',                    artist: 'Kevin MacLeod', genre: 'Funk',           cat: 'Party',     dur: 182, src: KM + 'Protofunk.mp3' },
  { id: 's15', title: 'Funkorama',                    artist: 'Kevin MacLeod', genre: 'Funk',           cat: 'Feel-good', dur: 201, src: KM + 'Funkorama.mp3' },
  { id: 's16', title: 'Sneaky Adventure',             artist: 'Kevin MacLeod', genre: 'Playful',        cat: 'Feel-good', dur: 73,  src: KM + 'Sneaky%20Adventure.mp3' },
  { id: 's17', title: 'Pixel Peeker Polka (Faster)',  artist: 'Kevin MacLeod', genre: 'Fast & silly',   cat: 'Party',     dur: 202, src: KM + 'Pixel%20Peeker%20Polka%20-%20faster.mp3' },
];
module.exports = { SONGS, songById: (id) => SONGS.find((s) => s.id === id) || null };
