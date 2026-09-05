/* NBT 编解码（无依赖，浏览器本地运行）
 * 支持 Tag 类型：End/Byte/Short/Int/Long/Float/Double/ByteArray/String/
 *              List/Compound/IntArray/LongArray
 * 压缩：gzip / zlib（基于 DecompressionStream / CompressionStream）
 */

"use strict";

const NBT_TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12,
};

class NBTWriter {
  constructor() {
    this.buf = [];
  }
  _u8(v) { this.buf.push(v & 0xff); }
  _u16(v) { this.buf.push((v >> 8) & 0xff, v & 0xff); }
  _u32(v) {
    this.buf.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  _u64(v) {
    // JS number -> 8 bytes big endian (BigInt safe path)
    const b = BigInt.asUintN(64, BigInt(v));
    for (let i = 7; i >= 0; i--) this.buf.push(Number((b >> BigInt(i * 8)) & 0xffn));
  }
  _f32(v) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, v, false);
    for (let i = 0; i < 4; i++) this.buf.push(dv.getUint8(i));
  }
  _f64(v) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v, false);
    for (let i = 0; i < 8; i++) this.buf.push(dv.getUint8(i));
  }
  _str(s) {
    const enc = new TextEncoder().encode(String(s));
    this._u16(enc.length);
    for (let i = 0; i < enc.length; i++) this.buf.push(enc[i]);
  }
  _raw(arr) { for (const b of arr) this.buf.push(b); }

  writeTag(tag, name, value) {
    this._u8(tag);
    if (name !== null && tag !== NBT_TAG.END) this._str(name);
    switch (tag) {
      case NBT_TAG.BYTE: this._u8(value & 0xff); break;
      case NBT_TAG.SHORT: this._u16(value & 0xffff); break;
      case NBT_TAG.INT: this._u32(value >>> 0); break;
      case NBT_TAG.LONG: this._u64(value); break;
      case NBT_TAG.FLOAT: this._f32(value); break;
      case NBT_TAG.DOUBLE: this._f64(value); break;
      case NBT_TAG.BYTE_ARRAY: {
        this._u32(value.length);
        for (const b of value) this.buf.push(b & 0xff);
        break;
      }
      case NBT_TAG.STRING: this._str(value); break;
      case NBT_TAG.LIST: {
        this._u8(value.tag ?? NBT_TAG.END);
        this._u32(value.length);
        for (const item of value) this.writeValue(value.tag ?? NBT_TAG.END, item);
        break;
      }
      case NBT_TAG.COMPOUND: {
        for (const [k, [t, v]] of Object.entries(value)) {
          if (v === undefined || v === null) continue;
          this.writeTag(t, k, v);
        }
        this._u8(NBT_TAG.END);
        break;
      }
      case NBT_TAG.INT_ARRAY: {
        this._u32(value.length);
        for (const v of value) this._u32(v >>> 0);
        break;
      }
      case NBT_TAG.LONG_ARRAY: {
        this._u32(value.length);
        for (const v of value) this._u64(v);
        break;
      }
    }
  }

  writeValue(tag, value) {
    switch (tag) {
      case NBT_TAG.BYTE: this._u8(value & 0xff); break;
      case NBT_TAG.SHORT: this._u16(value & 0xffff); break;
      case NBT_TAG.INT: this._u32(value >>> 0); break;
      case NBT_TAG.LONG: this._u64(value); break;
      case NBT_TAG.FLOAT: this._f32(value); break;
      case NBT_TAG.DOUBLE: this._f64(value); break;
      case NBT_TAG.BYTE_ARRAY: {
        this._u32(value.length);
        for (const b of value) this.buf.push(b & 0xff);
        break;
      }
      case NBT_TAG.STRING: this._str(value); break;
      case NBT_TAG.LIST: {
        this._u8(value.tag ?? NBT_TAG.END);
        this._u32(value.length);
        for (const item of value) this.writeValue(value.tag ?? NBT_TAG.END, item);
        break;
      }
      case NBT_TAG.COMPOUND: {
        for (const [k, [t, v]] of Object.entries(value)) {
          if (v === undefined || v === null) continue;
          this.writeTag(t, k, v);
        }
        this._u8(NBT_TAG.END);
        break;
      }
      case NBT_TAG.INT_ARRAY: {
        this._u32(value.length);
        for (const v of value) this._u32(v >>> 0);
        break;
      }
      case NBT_TAG.LONG_ARRAY: {
        this._u32(value.length);
        for (const v of value) this._u64(v);
        break;
      }
    }
  }

  toUint8Array() {
    return new Uint8Array(this.buf);
  }
}

class NBTReader {
  constructor(data, offset = 0) {
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = offset;
    this.data = data;
  }
  _u8() { const v = this.dv.getUint8(this.offset); this.offset += 1; return v; }
  _u16() { const v = this.dv.getUint16(this.offset, false); this.offset += 2; return v; }
  _u32() { const v = this.dv.getUint32(this.offset, false); this.offset += 4; return v; }
  _i8() { const v = this.dv.getInt8(this.offset); this.offset += 1; return v; }
  _i16() { const v = this.dv.getInt16(this.offset, false); this.offset += 2; return v; }
  _i32() { const v = this.dv.getInt32(this.offset, false); this.offset += 4; return v; }
  _i64() {
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.dv.getUint8(this.offset + i));
    this.offset += 8;
    return v;
  }
  _f32() { const v = this.dv.getFloat32(this.offset, false); this.offset += 4; return v; }
  _f64() { const v = this.dv.getFloat64(this.offset, false); this.offset += 8; return v; }
  _str() {
    const len = this._u16();
    const bytes = this.data.subarray(this.offset, this.offset + len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }
  _bytes(len) {
    const out = new Uint8Array(len);
    out.set(this.data.subarray(this.offset, this.offset + len));
    this.offset += len;
    return out;
  }
  _byteArray() {
    const len = this._u32();
    return this._bytes(len);
  }
  _intArray() {
    const len = this._u32();
    const out = new Int32Array(len);
    for (let i = 0; i < len; i++) out[i] = this._i32();
    return out;
  }
  _longArray() {
    const len = this._u32();
    const out = [];
    for (let i = 0; i < len; i++) out.push(this._i64());
    return out;
  }
  readNamedTag() {
    const tag = this._u8();
    if (tag === NBT_TAG.END) return [null, NBT_TAG.END, null];
    const name = this._str();
    return [name, tag, this.readValue(tag)];
  }
  readValue(tag) {
    switch (tag) {
      case NBT_TAG.BYTE: return this._i8();
      case NBT_TAG.SHORT: return this._i16();
      case NBT_TAG.INT: return this._i32();
      case NBT_TAG.LONG: return this._i64();
      case NBT_TAG.FLOAT: return this._f32();
      case NBT_TAG.DOUBLE: return this._f64();
      case NBT_TAG.BYTE_ARRAY: return this._byteArray();
      case NBT_TAG.STRING: return this._str();
      case NBT_TAG.LIST: {
        const elemTag = this._u8();
        const len = this._u32();
        const arr = [];
        arr.tag = elemTag;
        for (let i = 0; i < len; i++) arr.push(this.readValue(elemTag));
        return arr;
      }
      case NBT_TAG.COMPOUND: {
        const obj = {};
        while (true) {
          const [name, t, v] = this.readNamedTag();
          if (t === NBT_TAG.END) break;
          if (name !== null) obj[name] = [t, v];
        }
        return obj;
      }
      case NBT_TAG.INT_ARRAY: return this._intArray();
      case NBT_TAG.LONG_ARRAY: return this._longArray();
      default: throw new Error("未知 NBT Tag: " + tag);
    }
  }
}

async function decompress(data, format) {
  if (!format) return data;
  try {
    const ds = new DecompressionStream(format);
    return new Uint8Array(await new Response(data.stream().pipeThrough(ds)).arrayBuffer());
  } catch (e) {
    throw new Error(`解压失败 (${format}): ${e.message}`);
  }
}

async function compress(data, format) {
  if (!format) return data;
  try {
    const cs = new CompressionStream(format);
    const stream = new Blob([data]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    throw new Error(`压缩失败 (${format}): ${e.message}`);
  }
}

function detectCompression(data) {
  if (data.length < 2) return null;
  if (data[0] === 0x1f && data[1] === 0x8b) return "gzip";
  if ((data[0] & 0x0f) === 8 && ((data[0] >> 4) === 7 || (data[0] >> 4) === 8)) return "deflate";
  return null;
}

async function readNbtFile(data) {
  const format = detectCompression(data);
  const raw = format ? await decompress(data, format) : data;
  const reader = new NBTReader(raw);
  const [name, tag, value] = reader.readNamedTag();
  if (tag !== NBT_TAG.COMPOUND) throw new Error("NBT 根节点不是 Compound");
  return value;
}

async function writeNbtFile(compound, compressFormat = null) {
  const w = new NBTWriter();
  w.writeTag(NBT_TAG.COMPOUND, "", compound);
  let out = w.toUint8Array();
  if (compressFormat) out = await compress(out, compressFormat);
  return out;
}

const NBT = { TAG: NBT_TAG, readFile: readNbtFile, writeFile: writeNbtFile, detectCompression };