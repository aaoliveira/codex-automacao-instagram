import { BadRequestException } from "@nestjs/common";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectMediaFile } from "./media-file-metadata";

describe("media file inspection", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "media-inspection-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("detects PNG content and extracts safe metadata", async () => {
    const filePath = path.join(directory, "upload.tmp");
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    await writeFile(filePath, png);

    const result = await inspectMediaFile(filePath, "image/png");

    expect(result).toMatchObject({
      mimeType: "image/png",
      mediaKind: "IMAGE",
      width: 640,
      height: 480,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects MIME spoofing and unsupported signatures", async () => {
    const filePath = path.join(directory, "upload.tmp");
    await writeFile(filePath, Buffer.from("<svg onload=alert(1) />"));
    await expect(inspectMediaFile(filePath, "image/png")).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const pngPath = path.join(directory, "image.bin");
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await writeFile(pngPath, png);
    await expect(inspectMediaFile(pngPath, "image/jpeg")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
