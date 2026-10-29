import { crc32 } from "node:zlib";
// ZIP STORE entries: no executable names, no filesystem extraction, UTF-8 paths.
export function zip(files: Array<{ name: string; bytes: Buffer }>) {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (
      !/^(?:[a-z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(file.name) ||
      file.name.includes("..")
    )
      throw new Error("Invalid archive name");
    const name = Buffer.from(file.name),
      data = file.bytes;
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    locals.push(header, name, data);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export function csv(rows: Record<string, unknown>[]) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const quote = (value: unknown) => {
    let text =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    let first = 0;
    while (
      first < text.length &&
      (text.charCodeAt(first) <= 31 || /\s/.test(text[first]))
    )
      first++;
    if (/^[=+@-]/.test(text.slice(first))) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [
      keys.map(quote).join(";"),
      ...rows.map((row) => keys.map((key) => quote(row[key])).join(";")),
    ].join("\r\n") +
    "\r\n"
  );
}
