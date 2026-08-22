export const CHRONICLE_VERSION = '3.0.0';

export const GENRE_PROMPTS = {
    fantasy: "High fantasy setting, medieval world, intricate magic systems, mythical creatures, dragons and elves, epic quests, ancient ruins, sword and sorcery, grand narrative scale, world-building focus",
    cyberpunk: "Cyberpunk aesthetic, high-tech low-life, neon-drenched megacities, corporate dystopia, cybernetic enhancements, hackers and netrunners, rain-slicked chrome, synthetic transhumanism",
    noir: "Noir detective atmosphere, 1940s style, hardboiled narrative, femme fatales, chiaroscuro lighting, moral ambiguity, cynical tone, smoke and shadows, jazz undertones, crime thriller",
    scifi: "Space opera, galactic civilization, interstellar travel, advanced alien species, starship bridges, cosmic warfare, futuristic technology, dyson spheres, deep space exploration",
    lovecraft: "Eldritch horror, cosmic dread, Lovecraftian mythos, forbidden tomes, sanity-blasting visions, tentacles and slime, 1920s New England setting, psychological terror, the unknowable",
    postapoc: "Post-apocalyptic wasteland, scorched earth, survival of the fittest, scavenged technology, mutated flora and fauna, raiders and convoys, desolate beauty, resource scarcity, fallout aesthetics",
    steampunk: "Steampunk alternate history, Victorian era aesthetics, brass and copper machinery, steam-powered automatons, airships and dirigibles, clockwork gears, goggles and top hats, industrial revolution vibe",
    weirdwest: "Weird West, American frontier mixed with supernatural horror, dusty saloons, occult rituals, undead gunslingers, cryptids of the plains, folk horror, high noon duels with magic",
    grimdark: "Grimdark fantasy, gritty realism, morally grey characters, brutal combat, low magic, war-torn lands, mud and blood, nihilistic tone, medieval politics, visceral description",
    solarpunk: "Solarpunk, utopian future, nature and technology in harmony, art nouveau architecture, renewable energy, vertical gardens, optimistic tone, sustainable community, bright and verdant",
    gothic_horror: "Gothic horror, haunted mansions, Victorian dress, creeping fog, candlelight, family curses, romance and terror, crumbling architecture, storm-swept moors, psychological unease",
    urban_fantasy: "Urban fantasy, modern day setting with hidden magic, secret societies, supernatural creatures in subways, masquerade, street-level wizardry, police procedural with spells, neon noir",
    regency: "Regency era romance, Bridgerton style, high society, ballroom dances, intricate etiquette, courtships and scandals, pastel aesthetics, aristocracy, wit and banter",
    xianxia: "Xianxia cultivation, Chinese mythology, martial arts, flying swords, seeking immortality, qi energy, heavenly realms, ancient sects, spiritual beasts, eastern fantasy",
    space_western: "Space Western, frontier planets, bounty hunters in space, rusty spaceships, galactic outlaws, dusty spaceports, analog technology, harmonica soundtracks, lived-in universe",
    litrpg: "LitRPG, game mechanics in real life, leveling up, dungeon crawling, status screens, loot drops, MMORPG logic, guild politics, raid bosses, isekai elements",
    espionage: "Cold War espionage, spy thriller, gadgets and tradecraft, global conspiracy, undercover operations, interrogation rooms, microfilm and dead drops, political intrigue, high stakes poker",
    zombie: "Zombie apocalypse, outbreak survival, shambling hordes, boarded up safehouses, resource management, trust no one, urban decay, biological horror, pandemic scenario"
};

export const GENRE_OPTIONS = [
    { value: 'fantasy', label: 'High Fantasy' },
    { value: 'cyberpunk', label: 'Cyberpunk' },
    { value: 'noir', label: 'Noir Detective' },
    { value: 'scifi', label: 'Space Opera' },
    { value: 'lovecraft', label: 'Eldritch Horror' },
    { value: 'postapoc', label: 'Wasteland' },
    { value: 'steampunk', label: 'Steampunk' },
    { value: 'weirdwest', label: 'Weird West' },
    { value: 'grimdark', label: 'Grimdark' },
    { value: 'solarpunk', label: 'Solarpunk' },
    { value: 'gothic_horror', label: 'Gothic Horror' },
    { value: 'urban_fantasy', label: 'Urban Fantasy' },
    { value: 'regency', label: 'Regency Romance' },
    { value: 'xianxia', label: 'Xianxia/Cultivation' },
    { value: 'space_western', label: 'Space Western' },
    { value: 'litrpg', label: 'LitRPG' },
    { value: 'espionage', label: 'Cold War Spy' },
    { value: 'zombie', label: 'Zombie Outbreak' }
];

export const STYLE_PROMPTS = {
    oil_painting: "Traditional oil painting on canvas, heavy impasto texture, visible brushstrokes, classical composition, museum-quality fine art, dramatic lighting, rich color depth, old master style",
    watercolor: "Watercolor painting, wet-on-wet technique, rough paper texture, bleeding edges, soft pastel washes, artistic abstraction, delicate ink lines, dreamlike atmosphere",
    pixel_art: "16-bit pixel art, high-definition sprite work, SNES era aesthetic, dithering, limited color palette, isometric view, crisp edges, retro gaming nostalgia",
    cinematic: "Cinematic film still, anamorphic lens, 35mm photography, high dynamic range, dramatic lighting, depth of field, bokeh, color graded, blockbuster movie aesthetic, raytracing",
    comic: "Modern comic book art, bold black ink outlines, ben-day dots, cel-shaded, dynamic action poses, vibrant CMYK colors, graphic novel aesthetic, sharp contrast",
    blueprint: "Technical blueprint schematic, cyanotype blue background, white technical lines, grid overlay, cross-section views, architectural notation, engineering diagram style",
    ukiyoe: "Japanese Ukiyo-e woodblock print, washi paper texture, flat perspective, bold outlines, traditional Edo period aesthetic, muted organic colors, Hokusai style",
    synthwave: "Synthwave aesthetic, retro-futurism, neon purples and cyans, laser grids, VHS glitch effects, 1980s CGI style, chrome reflections, outrun visual style",
    anime_90s: "1990s anime aesthetic, hand-drawn cel animation, vintage grain, muted retro colors, detailed mechanical designs, dramatic angles, Ghost in the Shell style",
    low_poly: "Low poly 3D render, PlayStation 1 graphics, sharp geometric shapes, flat shading, nostalgic 3D, minimalist topology, glitch art elements, early computer graphics",
    claymation: "Stop-motion claymation, Aardman style, plasticine texture, thumbprints visible, miniature photography, tilt-shift effect, handmade dioramas, soft studio lighting",
    ink_wash: "Sumi-e ink wash painting, black and white, sweeping brush strokes, negative space, minimalist composition, rice paper texture, zen aesthetic, charcoal sketch elements",
    art_nouveau: "Art Nouveau, Alphonse Mucha style, intricate floral borders, stained glass aesthetic, flowing hair and fabric, gold leaf accents, decorative elegance, pastel palette",
    papercraft: "Papercraft illustration, layered paper cutouts, drop shadows for depth, collage style, textured cardstock, vibrant colors, storybook aesthetic, handmade feel",
    concept_art: "Digital concept art, speedpaint style, loose brushwork, atmospheric perspective, rule of thirds, video game environment art, epic scale, matte painting",
    vhs_horror: "Found footage aesthetic, VHS tape distortion, tracking errors, low resolution, night vision green, grainy ISO, camcorder overlay, analog horror vibe",
    risograph: "Risograph print, misaligned color layers, halftone dot patterns, limited ink colors, rough paper texture, zine aesthetic, retro printmaking style",
    liminal: "Liminal space photography, kenopsia, eerie empty places, fluorescent lighting, surreal mundane settings, infinite hallways, dreamcore, unsettlingly familiar"
};

export const STYLE_OPTIONS = [
    { value: 'oil_painting', label: 'Oil Painting' },
    { value: 'watercolor', label: 'Watercolor' },
    { value: 'pixel_art', label: 'Pixel Art' },
    { value: 'cinematic', label: 'Cinematic' },
    { value: 'comic', label: 'Comic Book' },
    { value: 'blueprint', label: 'Blueprint' },
    { value: 'ukiyoe', label: 'Ukiyo-e Print' },
    { value: 'synthwave', label: 'Synthwave' },
    { value: 'anime_90s', label: '90s Anime' },
    { value: 'low_poly', label: 'Low Poly 3D' },
    { value: 'claymation', label: 'Claymation' },
    { value: 'ink_wash', label: 'Ink Wash' },
    { value: 'art_nouveau', label: 'Art Nouveau' },
    { value: 'papercraft', label: 'Papercraft' },
    { value: 'concept_art', label: 'Concept Art' },
    { value: 'vhs_horror', label: 'VHS Horror' },
    { value: 'risograph', label: 'Risograph' },
    { value: 'liminal', label: 'Liminal Space' }
];

// Curated Voice Meta (12 Diverse Options)
export const VOICE_META = {
    // Male
    'Alnilam': { style: 'Low', gender: 'male' },
    'Fenrir': { style: 'Deep', gender: 'male' },
    'Charon': { style: 'Gravelly', gender: 'male' },
    'Puck': { style: 'Playful', gender: 'male' },
    'Zephyr': { style: 'Calm', gender: 'male' },
    'Orus': { style: 'Confident', gender: 'male' },
    // Female
    'Kore': { style: 'Soothing', gender: 'female' },
    'Aoede': { style: 'Musical', gender: 'female' },
    'Leda': { style: 'Bright', gender: 'female' },
    'Callirrhoe': { style: 'Calm', gender: 'female' },
    'Erinome': { style: 'Soft', gender: 'female' },
    'Sulafat': { style: 'Standard', gender: 'female' },

    'default': { style: 'Standard', gender: 'neutral' }
};

export const getVoiceMeta = (name) => VOICE_META[name] || VOICE_META['default'];

export const voicesList = Object.keys(VOICE_META).filter(v => v !== 'default');

export const DEFAULT_CONFIG = {
    setting: 'cyberpunk',
    settingCustom: '',
    style: 'pixel_art',
    styleCustom: '',
    mode: 'choice',
};

export const DEFAULT_CODEX = { characters: {}, places: {}, items: {} };

export const EMPTY_SUMMARY = { beats: [], longTerm: '', foldedThrough: 0 };

export const EMPTY_SCENE = {
    location: '',
    time_of_day: '',
    present_characters: [],
    goal: '',
    open_threads: [],
};

export const INITIAL_SUMMARY = "The story has just begun.";
