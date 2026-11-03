#!/usr/bin/env node
/**
 * Firmware signing (docs/board-protocol.md, "Firmware updates"). Boards install only a firmware
 * signed with this key, so even someone who takes over the server or an operator's account cannot
 * push their own firmware to the boards. The private key never goes to the server.
 *
 *   node firmware/sign.mjs keygen          once: a new key pair (asks for a passphrase)
 *   node firmware/sign.mjs <board>         signs firmware/dist/<board>/m2smart-board.bin
 *
 * keygen writes the private key, encrypted with the passphrase, to firmware/keys/ (never committed)
 * and the public key to firmware/certs/firmware_signing.pub.pem, which every build embeds. Keep a
 * copy of the private key and the passphrase somewhere safe and offline (a USB stick in a drawer):
 * without them no update can ever be signed for the boards already sold. M2_SIGNING_KEY may point
 * the script at the key elsewhere, e.g. on that USB stick.
 *
 * Signing writes firmware/dist/<board>/m2smart-<board>-<version>.m2fw: the image followed by its
 * signature, the one file the admin panel takes (layout: image, DER signature, its length as two
 * bytes little-endian, "M2SIG1").
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const privatePath = resolve(process.env.M2_SIGNING_KEY ?? join(here, "keys", "firmware-signing.pem"));
const publicPath = join(here, "certs", "firmware_signing.pub.pem");
export const TRAILER = Buffer.from("M2SIG1", "latin1");

async function passphrase(prompt) {
  if (process.env.M2_SIGNING_PASSPHRASE) return process.env.M2_SIGNING_PASSPHRASE;
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await input.question(prompt);
  input.close();
  return answer;
}

async function keygen() {
  if (existsSync(privatePath)) throw new Error(`A key already exists at ${privatePath}. A new one would lock out every board built with the old one; delete it yourself only if no board was ever sold.`);
  const first = await passphrase("New passphrase for the signing key (at least 12 characters): ");
  if (first.length < 12) throw new Error("The passphrase is too short.");
  if (!process.env.M2_SIGNING_PASSPHRASE && (await passphrase("Again: ")) !== first) throw new Error("The passphrases differ.");
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: first },
  });
  mkdirSync(dirname(privatePath), { recursive: true });
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey);
  console.log(`Private key (encrypted): ${privatePath}\nPublic key: ${publicPath}\nBack up the private key and the passphrase offline now.`);
}

/** The version in the image's app description (as the server reads it). */
function versionOf(image) {
  const field = image.subarray(0x30, 0x50);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? 32 : end).toString("latin1");
}

async function signBoard(board) {
  const imagePath = join(here, "dist", board, "m2smart-board.bin");
  if (!existsSync(imagePath)) throw new Error(`No ${imagePath}: build it first (sh firmware/build.sh ${board}).`);
  if (!existsSync(privatePath)) throw new Error(`No signing key at ${privatePath} (node firmware/sign.mjs keygen, or set M2_SIGNING_KEY).`);
  let key;
  try {
    key = createPrivateKey({ key: readFileSync(privatePath), passphrase: await passphrase("Passphrase of the signing key: ") });
  } catch {
    throw new Error("Wrong passphrase, or not a signing key.");
  }
  // The key must be the one the boards carry, or every board would refuse the update.
  if (createPublicKey(key).export({ type: "spki", format: "pem" }) !== readFileSync(publicPath, "utf8")) {
    throw new Error(`This key does not match ${publicPath}, which the boards carry.`);
  }
  const image = readFileSync(imagePath);
  const signature = sign("sha256", image, key);
  if (!verify("sha256", image, createPublicKey(key), signature)) throw new Error("Signature check failed.");
  const length = Buffer.alloc(2);
  length.writeUInt16LE(signature.length);
  const out = join(here, "dist", board, `m2smart-${board}-${versionOf(image)}.m2fw`);
  writeFileSync(out, Buffer.concat([image, signature, length, TRAILER]));
  console.log(`Signed: ${out}\nUpload this file in the admin panel → Firmware.`);
}

const command = process.argv[2];
try {
  if (command === "keygen") await keygen();
  else if (command && /^[a-z0-9]+$/.test(command)) await signBoard(command);
  else throw new Error("usage: node firmware/sign.mjs keygen | <board>");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
