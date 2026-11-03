import { ConfigService } from "@nestjs/config";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalStorageProvider } from "./local-storage.provider";

describe("LocalStorageProvider", () => {
  let directory: string;
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "local-media-storage-"));
    provider = new LocalStorageProvider(
      new ConfigService({
        MEDIA_LOCAL_ROOT: directory,
        MEDIA_URL_SIGNING_SECRET: "unit-test-media-signing-secret-over-32-characters",
        MEDIA_PUBLIC_API_URL: "http://localhost:3001",
      }),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("stores outside PostgreSQL, lists, signs, streams, and deletes a file", async () => {
    const sourcePath = path.join(directory, "upload.tmp");
    const content = Buffer.from("local-image-bytes");
    await writeFile(sourcePath, content);
    const key = "organization-id/asset-id.png";

    await provider.saveFile(sourcePath, key, "image/png");
    const objects = await provider.listObjects("organization-id");
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ key, sizeBytes: content.length });

    const signedUrl = await provider.createSignedReadUrl(
      key,
      "image/png",
      "photo.png",
      120,
    );
    const token = new URL(signedUrl).searchParams.get("token");
    expect(token).toBeTruthy();
    const signedFile = await provider.openSignedToken(token!);
    const chunks: Buffer[] = [];
    for await (const chunk of signedFile.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual(content);

    await provider.deleteObject(key);
    await expect(readFile(path.join(directory, key))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await provider.listObjects("organization-id")).toHaveLength(0);
  });

  it("does not allow keys to escape the configured storage root", async () => {
    await expect(provider.deleteObject("../outside.bin")).rejects.toThrow();
  });
});
