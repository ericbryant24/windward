/** Shared loading helpers for the baked binary data files. */

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('no DecompressionStream');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Fetch (or take embedded base64) and gunzip into a DataView. */
export async function loadPacked(url, embedded = null) {
  let bytes;
  if (embedded) bytes = base64ToBytes(embedded);
  else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const buffer = await gunzip(bytes);
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export function readMagic(view) {
  return String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
}
