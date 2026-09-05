/* 结构文件本地转换引擎（无依赖，浏览器内运行）
 * 支持：litematic / mcstructure / schematic 双向互转
 */

"use strict";

const FORMATS = [
  { id: "mcstructure", label: "MC结构 (.mcstructure)", ext: ".mcstructure", in: true, out: true },
  { id: "litematic", label: "Litematica (.litematic)", ext: ".litematic", in: true, out: true },
  { id: "schematic", label: "Schematic (.schematic)", ext: ".schematic", in: true, out: true },
];

const SOURCE_EXTS = {
  ".mcstructure": "mcstructure",
  ".litematic": "litematic",
  ".schematic": "schematic",
  ".schem": "schematic",
};

class ConversionError extends Error {}

function detectSource(name) {
  const ext = "." + (name || "").toLowerCase().split(".").pop();
  const fmt = SOURCE_EXTS[ext];
  if (!fmt) throw new ConversionError(`不支持的文件格式: ${name}`);
  return fmt;
}

/* ---------- 通用结构表示 ---------- */

function makeStructure(size, palette, indices) {
  return { size, palette, indices };
}

/* ---------- litematic ---------- */

function unpackLitematicBlockStates(longs, size, paletteLen) {
  const count = size[0] * size[1] * size[2];
  const bits = Math.max(2, Math.ceil(Math.log2(paletteLen)));
  const mask = (1 << bits) - 1;
  const out = new Int32Array(count);
  let longIdx = 0, bitOff = 0;
  for (let i = 0; i < count; i++) {
    let value = Number(longs[longIdx] >> BigInt(bitOff)) & mask;
    out[i] = value;
    bitOff += bits;
    while (bitOff >= 64) { bitOff -= 64; longIdx++; }
  }
  return out;
}

function packLitematicBlockStates(indices, size, paletteLen) {
  const count = size[0] * size[1] * size[2];
  const bits = Math.max(2, Math.ceil(Math.log2(paletteLen)));
  const mask = (1 << bits) - 1;
  const numLongs = Math.ceil((count * bits) / 64);
  const longs = new Array(numLongs).fill(0n);
  let longIdx = 0, bitOff = 0;
  for (let i = 0; i < count; i++) {
    longs[longIdx] |= BigInt(indices[i] & mask) << BigInt(bitOff);
    bitOff += bits;
    while (bitOff >= 64) { bitOff -= 64; longIdx++; }
  }
  return longs;
}

function litematicToCommon(root) {
  const regions = root["Regions"] || {};
  const regionNames = Object.keys(regions);
  if (!regionNames.length) throw new ConversionError("litematic 中没有区域");
  const name = regionNames[0];
  const reg = regions[name];
  const size = Array.from(reg["Size"] || [0, 0, 0]);
  if (!size[0] || !size[1] || !size[2]) throw new ConversionError("区域尺寸无效");
  const paletteRaw = reg["BlockStatePalette"] || [];
  const palette = paletteRaw.map(p => ({
    name: String(p["Name"] || "minecraft:air"),
    states: p["Properties"] || {},
  }));
  const longs = reg["BlockStates"] || [];
  const indices = unpackLitematicBlockStates(longs, size, palette.length || 1);
  return { size, palette, indices, regionName: name };
}

function commonToLitematic(common, meta) {
  const { size, palette, indices } = common;
  const longs = packLitematicBlockStates(indices, size, palette.length || 1);
  const now = Date.now();
  return {
    "Version": [3, 6],
    "SubVersion": 0,
    "Metadata": {
      "Name": (meta && meta.name) || "Converted",
      "Author": "StructureConverter",
      "Description": "",
      "RegionCount": 1,
      "TimeCreated": now,
      "TimeModified": now,
      "TotalBlocks": indices.length,
      "TotalVolume": size[0] * size[1] * size[2],
    },
    "Regions": {
      "main": {
        "Position": [0, 0, 0],
        "Size": [...size],
        "BlockStatePalette": palette.map(p => ({
          "Name": p.name,
          "Properties": Object.keys(p.states || {}).length ? p.states : undefined,
        })),
        "BlockStates": longs,
        "Entities": [],
        "PendingBlockTicks": [],
        "PendingFluidTicks": [],
      },
    },
  };
}

/* ---------- mcstructure ---------- */

function mcstructureToCommon(root) {
  const size = Array.from(root["size"] || [0, 0, 0]);
  const struct = root["structure"] || {};
  const blockIndices = struct["block_indices"] || [];
  const indices0 = blockIndices[0] || [];
  const paletteObj = struct["palette"] || {};
  const def = paletteObj["default"] || {};
  const palette = (def["block_palette"] || []).map(b => ({
    name: String(b["name"] || "minecraft:air"),
    states: b["states"] || {},
  }));
  if (!size[0] || !size[1] || !size[2]) throw new ConversionError("mcstructure 尺寸无效");
  return { size, palette, indices: new Int32Array(Array.from(indices0)) };
}

function commonToMcstructure(common) {
  const { size, palette, indices } = common;
  return {
    "format_version": 1,
    "size": [...size],
    "structure": {
      "block_indices": [
        Array.from(indices),
        new Array(indices.length).fill(-1),
      ],
      "entities": [],
      "palette": {
        "default": {
          "block_palette": palette.map(p => ({
            "name": p.name,
            "states": p.states || {},
          })),
          "block_position_data": {},
        },
      },
    },
  };
}

/* ---------- schematic ---------- */

function schematicToCommon(root) {
  const w = Number(root["Width"] || 0);
  const h = Number(root["Height"] || 0);
  const l = Number(root["Length"] || 0);
  if (!w || !h || !l) throw new ConversionError("schematic 尺寸无效");
  const size = [w, h, l];
  const blocks = root["Blocks"] || [];
  const data = root["Data"] || [];
  const blockEntities = root["BlockEntities"] || [];
  const paletteMap = new Map();
  const palette = [];
  const indices = new Int32Array(w * h * l);
  const indexOf = (key) => {
    if (paletteMap.has(key)) return paletteMap.get(key);
    const idx = palette.length;
    paletteMap.set(key, idx);
    palette.push(key);
    return idx;
  };
  // 记录方块实体位置，用实体名标记对应方块
  const beMap = new Map();
  for (const be of blockEntities) {
    const p = Array.from(be["Pos"] || [0, 0, 0]);
    beMap.set(`${p[0]},${p[1]},${p[2]}`, String(be["Id"] || "minecraft:air"));
  }
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < l; z++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * l + z) * w + x;
        let id = blocks[idx] != null ? blocks[idx] : 0;
        let d = data[idx] != null ? data[idx] : 0;
        const be = beMap.get(`${x},${y},${z}`);
        let name = idToName(id, d, be);
        if (name === null) name = "minecraft:air";
        indices[idx] = indexOf({ name, states: {} });
      }
    }
  }
  return { size, palette, indices };
}

function idToName(id, data, blockEntityId) {
  if (blockEntityId && /^[a-z_]+:[a-z_]+$/.test(blockEntityId)) return blockEntityId;
  const legacy = LEGACY_IDS[`${id}:${data}`] || LEGACY_IDS[`${id}:0`];
  if (legacy) return legacy;
  if (id === 0) return "minecraft:air";
  return null;
}

function commonToSchematic(common) {
  const { size, palette, indices } = common;
  const [w, h, l] = size;
  const blocks = new Uint8Array(w * h * l);
  const data = new Uint8Array(w * h * l);
  const blockEntities = [];
  const nameToId = new Map();
  palette.forEach((p, i) => {
    nameToId.set(p.name, i);
  });
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < l; z++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * l + z) * w + x;
        const p = palette[indices[idx]] || { name: "minecraft:air" };
        const found = nameToId.get(p.name);
        const legacy = nameToLegacy(p.name);
        blocks[idx] = legacy ? legacy[0] : 0;
        data[idx] = legacy ? legacy[1] : 0;
      }
    }
  }
  return {
    "Width": w,
    "Height": h,
    "Length": l,
    "Materials": "Alpha",
    "Blocks": blocks,
    "Data": data,
    "AddBlocks": new Uint8Array(0),
    "BlockEntities": blockEntities,
    "Entities": [],
  };
}

/* ---------- 旧版方块 ID 表（核心常用） ---------- */

const LEGACY_IDS = {
  "1:0": "minecraft:stone", "1:1": "minecraft:granite", "1:2": "minecraft:polished_granite",
  "1:3": "minecraft:diorite", "1:4": "minecraft:polished_diorite", "1:5": "minecraft:andesite",
  "1:6": "minecraft:polished_andesite",
  "2:0": "minecraft:grass_block", "3:0": "minecraft:dirt", "4:0": "minecraft:cobblestone",
  "5:0": "minecraft:oak_planks", "5:1": "minecraft:spruce_planks", "5:2": "minecraft:birch_planks",
  "5:3": "minecraft:jungle_planks", "5:4": "minecraft:acacia_planks", "5:5": "minecraft:dark_oak_planks",
  "7:0": "minecraft:bedrock", "8:0": "minecraft:water", "9:0": "minecraft:water",
  "10:0": "minecraft:lava", "11:0": "minecraft:lava", "12:0": "minecraft:sand",
  "12:1": "minecraft:red_sand", "13:0": "minecraft:gravel", "14:0": "minecraft:gold_ore",
  "15:0": "minecraft:iron_ore", "16:0": "minecraft:coal_ore", "17:0": "minecraft:oak_log",
  "17:1": "minecraft:spruce_log", "17:2": "minecraft:birch_log", "17:3": "minecraft:jungle_log",
  "18:0": "minecraft:oak_leaves", "18:1": "minecraft:spruce_leaves", "18:2": "minecraft:birch_leaves",
  "18:3": "minecraft:jungle_leaves", "19:0": "minecraft:sponge", "20:0": "minecraft:glass",
  "21:0": "minecraft:lapis_ore", "22:0": "minecraft:lapis_block", "23:0": "minecraft:dispenser",
  "24:0": "minecraft:sandstone", "25:0": "minecraft:note_block", "26:0": "minecraft:bed",
  "30:0": "minecraft:cobweb", "31:0": "minecraft:short_grass", "31:1": "minecraft:fern",
  "32:0": "minecraft:dead_bush", "33:0": "minecraft:piston", "35:0": "minecraft:white_wool",
  "35:1": "minecraft:orange_wool", "35:2": "minecraft:magenta_wool", "35:3": "minecraft:light_blue_wool",
  "35:4": "minecraft:yellow_wool", "35:5": "minecraft:lime_wool", "35:6": "minecraft:pink_wool",
  "35:7": "minecraft:gray_wool", "35:8": "minecraft:light_gray_wool", "35:9": "minecraft:cyan_wool",
  "35:10": "minecraft:purple_wool", "35:11": "minecraft:blue_wool", "35:12": "minecraft:brown_wool",
  "35:13": "minecraft:green_wool", "35:14": "minecraft:red_wool", "35:15": "minecraft:black_wool",
  "41:0": "minecraft:gold_block", "42:0": "minecraft:iron_block", "43:0": "minecraft:stone_slab",
  "44:0": "minecraft:stone_slab", "45:0": "minecraft:bricks", "46:0": "minecraft:tnt",
  "47:0": "minecraft:bookshelf", "48:0": "minecraft:mossy_cobblestone", "49:0": "minecraft:obsidian",
  "50:0": "minecraft:torch", "53:0": "minecraft:oak_stairs", "57:0": "minecraft:diamond_block",
  "58:0": "minecraft:crafting_table", "61:0": "minecraft:furnace", "62:0": "minecraft:furnace",
  "65:0": "minecraft:ladder", "66:0": "minecraft:rail", "67:0": "minecraft:cobblestone_stairs",
  "73:0": "minecraft:redstone_ore", "74:0": "minecraft:redstone_ore", "78:0": "minecraft:snow",
  "79:0": "minecraft:ice", "80:0": "minecraft:snow_block", "82:0": "minecraft:clay",
  "86:0": "minecraft:pumpkin", "87:0": "minecraft:netherrack", "88:0": "minecraft:soul_sand",
  "89:0": "minecraft:glowstone", "95:0": "minecraft:stained_glass",
  "98:0": "minecraft:stone_bricks", "98:1": "minecraft:mossy_stone_bricks", "98:2": "minecraft:cracked_stone_bricks",
  "103:0": "minecraft:melon", "110:0": "minecraft:mycelium", "112:0": "minecraft:nether_bricks",
  "121:0": "minecraft:end_stone", "133:0": "minecraft:emerald_block", "137:0": "minecraft:command_block",
  "152:0": "minecraft:redstone_block", "155:0": "minecraft:quartz_block", "156:0": "minecraft:quartz_stairs",
  "159:0": "minecraft:stained_hardened_clay", "169:0": "minecraft:sea_lantern", "173:0": "minecraft:coal_block",
};

const NAME_TO_LEGACY = Object.fromEntries(
  Object.entries(LEGACY_IDS).map(([k, v]) => [v, k.split(":").map(Number)])
);

function nameToLegacy(name) {
  if (name === "minecraft:air") return [0, 0];
  const found = NAME_TO_LEGACY[name];
  if (found) return found;
  const simple = LEGACY_SIMPLE[name];
  return simple;
}

const LEGACY_SIMPLE = {
  "minecraft:stone": [1, 0], "minecraft:grass_block": [2, 0], "minecraft:dirt": [3, 0],
  "minecraft:cobblestone": [4, 0], "minecraft:oak_planks": [5, 0], "minecraft:bedrock": [7, 0],
  "minecraft:sand": [12, 0], "minecraft:gravel": [13, 0], "minecraft:gold_ore": [14, 0],
  "minecraft:iron_ore": [15, 0], "minecraft:coal_ore": [16, 0], "minecraft:oak_log": [17, 0],
  "minecraft:oak_leaves": [18, 0], "minecraft:glass": [20, 0], "minecraft:lapis_ore": [21, 0],
  "minecraft:lapis_block": [22, 0], "minecraft:wool": [35, 0], "minecraft:white_wool": [35, 0],
  "minecraft:gold_block": [41, 0], "minecraft:iron_block": [42, 0], "minecraft:bricks": [45, 0],
  "minecraft:tnt": [46, 0], "minecraft:bookshelf": [47, 0], "minecraft:mossy_cobblestone": [48, 0],
  "minecraft:obsidian": [49, 0], "minecraft:torch": [50, 0], "minecraft:crafting_table": [58, 0],
  "minecraft:furnace": [61, 0], "minecraft:ladder": [65, 0], "minecraft:rail": [66, 0],
  "minecraft:snow": [78, 0], "minecraft:ice": [79, 0], "minecraft:snow_block": [80, 0],
  "minecraft:clay": [82, 0], "minecraft:pumpkin": [86, 0], "minecraft:netherrack": [87, 0],
  "minecraft:soul_sand": [88, 0], "minecraft:glowstone": [89, 0], "minecraft:stone_bricks": [98, 0],
  "minecraft:melon": [103, 0], "minecraft:mycelium": [110, 0], "minecraft:nether_bricks": [112, 0],
  "minecraft:end_stone": [121, 0], "minecraft:emerald_block": [133, 0], "minecraft:command_block": [137, 0],
  "minecraft:redstone_block": [152, 0], "minecraft:quartz_block": [155, 0], "minecraft:sea_lantern": [169, 0],
  "minecraft:coal_block": [173, 0],
};

/* ---------- 转换主流程 ---------- */

async function convertFile(file, targetFormat, onProgress) {
  onProgress && onProgress(0.05, "读取文件…");
  const srcFormat = detectSource(file.name);
  const data = new Uint8Array(await file.arrayBuffer());
  onProgress && onProgress(0.15, "解析 NBT…");
  const root = await NBT.readFile(data);
  let common;
  if (srcFormat === "litematic") common = litematicToCommon(root);
  else if (srcFormat === "mcstructure") common = mcstructureToCommon(root);
  else common = schematicToCommon(root);
  onProgress && onProgress(0.45, `方块调色板 ${common.palette.length} 种…`);

  if (srcFormat === targetFormat) {
    throw new ConversionError("源格式与目标格式相同");
  }

  onProgress && onProgress(0.6, "构建目标文件…");
  let outRoot, compressFormat = null;
  if (targetFormat === "litematic") {
    outRoot = commonToLitematic(common, { name: stripExt(file.name) });
    compressFormat = "gzip";
  } else if (targetFormat === "mcstructure") {
    outRoot = commonToMcstructure(common);
    compressFormat = null;
  } else {
    outRoot = commonToSchematic(common);
    compressFormat = "gzip";
  }
  onProgress && onProgress(0.8, "写入…");
  const outData = await NBT.writeFile(outRoot, compressFormat);
  onProgress && onProgress(1, "完成");
  const outName = stripExt(file.name) + FORMATS.find(f => f.id === targetFormat).ext;
  return { data: outData, name: outName };
}

function stripExt(name) {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

const Converter = {
  FORMATS,
  SOURCE_EXTS,
  convertFile,
  detectSource,
  ConversionError,
};