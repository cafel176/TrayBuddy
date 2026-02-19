/**
 * pngremix-decoder
 *
 * Decode PNGTuber Remix `.pngRemix` files (Godot 4 `FileAccess.store_var(data, true)` output).
 *
 * Public API (browser global):
 *   - `PngRemixDecoder.decode(arrayBuffer)`
 *   - `PngRemixDecoder.decodeFile(fileOrBlob)`
 */

(function initPngRemixDecoder(global) {
  'use strict';

  /**
   * Godot 4 Binary Variant Deserializer.
   * Parses binary data produced by Godot's `FileAccess.store_var(data, true)`.
   */
  class GodotVariantParser {
    constructor(buffer) {
      if (!(buffer instanceof ArrayBuffer)) {
        throw new TypeError('GodotVariantParser: expected ArrayBuffer');
      }
      this.view = new DataView(buffer);
      this.buf = new Uint8Array(buffer);
      this.offset = 0;
      this.len = buffer.byteLength;
      this._textDecoder = new TextDecoder('utf-8');
    }

    _u32() {
      const v = this.view.getUint32(this.offset, true);
      this.offset += 4;
      return v;
    }
    _i32() {
      const v = this.view.getInt32(this.offset, true);
      this.offset += 4;
      return v;
    }
    _i64() {
      // NOTE: Godot uses signed 64-bit; here we return JS Number.
      // This loses precision above 2^53-1, but Remix ids are typically safe.
      const lo = this.view.getUint32(this.offset, true);
      const hi = this.view.getInt32(this.offset + 4, true);
      this.offset += 8;
      return hi * 0x100000000 + lo;
    }
    _f32() {
      const v = this.view.getFloat32(this.offset, true);
      this.offset += 4;
      return v;
    }
    _f64() {
      const v = this.view.getFloat64(this.offset, true);
      this.offset += 8;
      return v;
    }
    _padTo4() {
      const rem = this.offset % 4;
      if (rem !== 0) this.offset += 4 - rem;
    }
    _string() {
      const len = this._u32();
      const bytes = this.buf.slice(this.offset, this.offset + len);
      this.offset += len;
      this._padTo4();
      return this._textDecoder.decode(bytes);
    }

    parseVariant() {
      if (this.offset >= this.len) return null;

      // Godot 4 tag layout (VariantParser):
      // - low 8 bits: type id
      // - high bits: flags (notably bit0 means 64-bit for INT/FLOAT)
      const header = this._u32();
      const typeId = header & 0xff;
      const flags = header >> 16;
      const is64 = (flags & 1) !== 0;

      switch (typeId) {
        case 0: // NIL
          return null;
        case 1: // BOOL
          return this._u32() !== 0;
        case 2: // INT
          return is64 ? this._i64() : this._i32();
        case 3: // FLOAT
          return is64 ? this._f64() : this._f32();
        case 4: // STRING
          return this._string();
        case 5: // VECTOR2
          return { _type: 'Vector2', x: is64 ? this._f64() : this._f32(), y: is64 ? this._f64() : this._f32() };
        case 6: // VECTOR2I
          return { _type: 'Vector2i', x: this._i32(), y: this._i32() };
        case 7: // RECT2
          if (is64) return { _type: 'Rect2', x: this._f64(), y: this._f64(), w: this._f64(), h: this._f64() };
          return { _type: 'Rect2', x: this._f32(), y: this._f32(), w: this._f32(), h: this._f32() };
        case 8: // RECT2I
          return { _type: 'Rect2i', x: this._i32(), y: this._i32(), w: this._i32(), h: this._i32() };
        case 9: // VECTOR3
          if (is64) return { _type: 'Vector3', x: this._f64(), y: this._f64(), z: this._f64() };
          return { _type: 'Vector3', x: this._f32(), y: this._f32(), z: this._f32() };
        case 10: // VECTOR3I
          return { _type: 'Vector3i', x: this._i32(), y: this._i32(), z: this._i32() };
        case 11: { // TRANSFORM2D (6 floats)
          const rf = is64 ? () => this._f64() : () => this._f32();
          return { _type: 'Transform2D', xx: rf(), xy: rf(), yx: rf(), yy: rf(), ox: rf(), oy: rf() };
        }
        case 12: { // VECTOR4
          const rf = is64 ? () => this._f64() : () => this._f32();
          return { _type: 'Vector4', x: rf(), y: rf(), z: rf(), w: rf() };
        }
        case 13: // VECTOR4I
          return { _type: 'Vector4i', x: this._i32(), y: this._i32(), z: this._i32(), w: this._i32() };
        case 14: { // PLANE
          const rf = is64 ? () => this._f64() : () => this._f32();
          return { _type: 'Plane', nx: rf(), ny: rf(), nz: rf(), d: rf() };
        }
        case 15: { // QUATERNION
          const rf = is64 ? () => this._f64() : () => this._f32();
          return { _type: 'Quaternion', x: rf(), y: rf(), z: rf(), w: rf() };
        }
        case 16: { // AABB
          const rf = is64 ? () => this._f64() : () => this._f32();
          return { _type: 'AABB', px: rf(), py: rf(), pz: rf(), sx: rf(), sy: rf(), sz: rf() };
        }
        case 17: { // BASIS (9 floats)
          const rf = is64 ? () => this._f64() : () => this._f32();
          const m = [];
          for (let i = 0; i < 9; i++) m.push(rf());
          return { _type: 'Basis', m };
        }
        case 18: { // TRANSFORM3D (12 floats)
          const rf = is64 ? () => this._f64() : () => this._f32();
          const m = [];
          for (let i = 0; i < 12; i++) m.push(rf());
          return { _type: 'Transform3D', m };
        }
        case 19: { // PROJECTION (16 floats)
          const rf = is64 ? () => this._f64() : () => this._f32();
          const m = [];
          for (let i = 0; i < 16; i++) m.push(rf());
          return { _type: 'Projection', m };
        }
        case 20: // COLOR (4 x float32)
          return { _type: 'Color', r: this._f32(), g: this._f32(), b: this._f32(), a: this._f32() };
        case 21: // STRING_NAME
          return this._string();
        case 22: { // NODE_PATH
          const nameCount = this._u32() & 0x7fffffff;
          const subNameCount = this._u32();
          this._u32(); // pathFlags
          const names = [];
          for (let i = 0; i < nameCount; i++) names.push(this._string());
          const subNames = [];
          for (let i = 0; i < subNameCount; i++) subNames.push(this._string());
          return { _type: 'NodePath', path: names.join('/'), subNames };
        }
        case 23: // RID
          return { _type: 'RID' };
        case 24: { // OBJECT
          // This is rarely used in Remix saves; keep a permissive reader.
          const objFlags = flags;
          if (objFlags & 1) {
            const id = this._i64();
            return { _type: 'Object', id };
          }
          const className = this._string();
          const propCount = this._u32();
          const props = {};
          for (let i = 0; i < propCount; i++) {
            const name = this._string();
            const value = this.parseVariant();
            props[name] = value;
          }
          return { _type: 'Object', className, props };
        }
        case 25: // CALLABLE
          return { _type: 'Callable' };
        case 26: // SIGNAL
          return { _type: 'Signal' };
        case 27: { // DICTIONARY
          const raw = this._u32();
          const count = raw & 0x7fffffff;
          const dict = {};
          const _keys = [];
          for (let i = 0; i < count; i++) {
            const key = this.parseVariant();
            const val = this.parseVariant();
            const k = typeof key === 'string' ? key : JSON.stringify(key);
            dict[k] = val;
            _keys.push(k);
          }
          dict._keys = _keys;
          return dict;
        }
        case 28: { // ARRAY
          const raw = this._u32();
          const count = raw & 0x7fffffff;
          const arr = [];
          for (let i = 0; i < count; i++) arr.push(this.parseVariant());
          return arr;
        }
        case 29: { // PACKED_BYTE_ARRAY
          const len = this._u32();
          const data = new Uint8Array(this.buf.buffer, this.buf.byteOffset + this.offset, len);
          const copy = new Uint8Array(len);
          copy.set(data);
          this.offset += len;
          this._padTo4();
          return copy;
        }
        case 30: { // PACKED_INT32_ARRAY
          const count = this._u32();
          const arr = new Int32Array(count);
          for (let i = 0; i < count; i++) arr[i] = this._i32();
          return arr;
        }
        case 31: { // PACKED_INT64_ARRAY
          const count = this._u32();
          const arr = [];
          for (let i = 0; i < count; i++) arr.push(this._i64());
          return arr;
        }
        case 32: { // PACKED_FLOAT32_ARRAY
          const count = this._u32();
          const arr = new Float32Array(count);
          for (let i = 0; i < count; i++) arr[i] = this._f32();
          return arr;
        }
        case 33: { // PACKED_FLOAT64_ARRAY
          const count = this._u32();
          const arr = new Float64Array(count);
          for (let i = 0; i < count; i++) arr[i] = this._f64();
          return arr;
        }
        case 34: { // PACKED_STRING_ARRAY
          const count = this._u32();
          const arr = [];
          for (let i = 0; i < count; i++) arr.push(this._string());
          return arr;
        }
        case 35: { // PACKED_VECTOR2_ARRAY
          const count = this._u32();
          const arr = [];
          const rf = is64 ? () => this._f64() : () => this._f32();
          for (let i = 0; i < count; i++) arr.push({ x: rf(), y: rf() });
          return arr;
        }
        case 36: { // PACKED_VECTOR3_ARRAY
          const count = this._u32();
          const arr = [];
          const rf = is64 ? () => this._f64() : () => this._f32();
          for (let i = 0; i < count; i++) arr.push({ x: rf(), y: rf(), z: rf() });
          return arr;
        }
        case 37: { // PACKED_COLOR_ARRAY
          const count = this._u32();
          const arr = [];
          for (let i = 0; i < count; i++) arr.push({ r: this._f32(), g: this._f32(), b: this._f32(), a: this._f32() });
          return arr;
        }
        case 38: { // PACKED_VECTOR4_ARRAY
          const count = this._u32();
          const arr = [];
          const rf = is64 ? () => this._f64() : () => this._f32();
          for (let i = 0; i < count; i++) arr.push({ x: rf(), y: rf(), z: rf(), w: rf() });
          return arr;
        }
        default:
          console.warn(`[PngRemixDecoder] Unknown Godot Variant typeId=${typeId} at offset=${this.offset - 4}`);
          return { _type: 'Unknown', typeId };
      }
    }

    static parse(buffer) {
      const parser = new GodotVariantParser(buffer);

      // Godot store_var writes a 4-byte length prefix before the Variant.
      parser.offset = 4;

      return parser.parseVariant();
    }
  }

  function decode(arrayBuffer) {
    // Prefer an already-available parser (e.g. if another tool ships one)
    if (global.GodotVariantParser && typeof global.GodotVariantParser.parse === 'function') {
      return global.GodotVariantParser.parse(arrayBuffer);
    }
    return GodotVariantParser.parse(arrayBuffer);
  }

  async function decodeFile(fileOrBlob) {
    if (!fileOrBlob || typeof fileOrBlob.arrayBuffer !== 'function') {
      throw new TypeError('PngRemixDecoder.decodeFile: expected File/Blob');
    }
    const buf = await fileOrBlob.arrayBuffer();
    return decode(buf);
  }

  global.PngRemixDecoder = {
    decode,
    decodeFile,
    GodotVariantParser,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.PngRemixDecoder;
  }
})(typeof window !== 'undefined' ? window : globalThis);
