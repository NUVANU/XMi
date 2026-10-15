// Fixed API-only child entry. No user filename, format string or CLI arguments.
import {extractRawText} from "@xmi/mammoth-api";

const chunks: Buffer[] = [];
let size = 0;
try {
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 5 * 1024 * 1024) {process.exitCode = 2; throw new Error("limit");}
    chunks.push(bytes);
  }
  const result = await extractRawText({buffer: Buffer.concat(chunks)});
  if (Buffer.byteLength(result.value, "utf8") > 1024 * 1024) process.exitCode = 2;
  else process.stdout.write(result.value);
} catch {
  // Third-party errors can contain private document data; never forward them.
  process.exitCode ??= 1;
}
