import { INestApplication, ValidationPipe } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { Test } from "@nestjs/testing";
import { PublicationMediaType } from "@prisma/client";
import { Queue } from "bullmq";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { INSTAGRAM_PUBLICATION_QUEUE } from "../src/publishing/publication.constants";
import { publicationJobId } from "../src/publishing/publishing.service";
import { MediaStorageService } from "../src/media/storage/media-storage.service";

describe("Media library (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  let storage: MediaStorageService;
  const createdPublicationIds: string[] = [];
  const createdOrganizationIds: string[] = [];
  const createdUserEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    prisma = app.get(PrismaService);
    storage = app.get(MediaStorageService);
    queue = app.get<Queue>(getQueueToken(INSTAGRAM_PUBLICATION_QUEUE));
    await app.init();
  });

  afterAll(async () => {
    for (const publicationId of createdPublicationIds) {
      const job = await queue?.getJob(publicationJobId(publicationId));
      if (job) await job.remove().catch(() => undefined);
    }
    if (createdOrganizationIds.length > 0) {
      const assets = await prisma.mediaAsset.findMany({
        where: { organizationId: { in: createdOrganizationIds } },
      });
      for (const asset of assets) {
        await storage
          .deleteObject(asset.storageType, asset.storageKey)
          .catch(() => undefined);
      }
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrganizationIds } },
      });
    }
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    await app?.close();
  });

  it("uploads locally, isolates metadata by tenant, publishes a MOCK asset, and deletes it", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [owner, otherOwner] = await Promise.all([
      register(`media-owner-${suffix}@example.com`, `Media Tenant ${suffix}`),
      register(`media-other-${suffix}@example.com`, `Other Media Tenant ${suffix}`),
    ]);
    createdOrganizationIds.push(owner.body.organizationId, otherOwner.body.organizationId);
    const ownerAuth = `Bearer ${owner.body.accessToken}`;
    const otherAuth = `Bearer ${otherOwner.body.accessToken}`;
    const assetsPath = `/api/organizations/${owner.body.organizationId}/media-assets`;

    const upload = await request(app.getHttpServer())
      .post(assetsPath)
      .query({ deduplicate: "true" })
      .set("Authorization", ownerAuth)
      .attach("file", pngFixture(128, 64), {
        filename: "campaign-photo.png",
        contentType: "image/png",
      })
      .expect(201);
    const asset = upload.body;
    expect(asset).toMatchObject({
      organizationId: owner.body.organizationId,
      originalFileName: "campaign-photo.png",
      mimeType: "image/png",
      mediaKind: "IMAGE",
      width: 128,
      height: 64,
    });
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset).not.toHaveProperty("storageKey");
    expect(asset).not.toHaveProperty("fileBytes");

    const duplicate = await request(app.getHttpServer())
      .post(assetsPath)
      .query({ deduplicate: "true" })
      .set("Authorization", ownerAuth)
      .attach("file", pngFixture(128, 64), {
        filename: "duplicate-name.png",
        contentType: "image/png",
      })
      .expect(201);
    expect(duplicate.body.id).toBe(asset.id);

    const list = await request(app.getHttpServer())
      .get(assetsPath)
      .query({ page: 1, pageSize: 10, search: "campaign-photo" })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(list.body.items[0].id).toBe(asset.id);

    const signed = await request(app.getHttpServer())
      .get(`${assetsPath}/${asset.id}/signed-url`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(signed.body.expiresAt).toBeTruthy();
    expect(signed.body.url).toContain("/api/media/local?");
    const signedUrl = new URL(signed.body.url);
    await request(app.getHttpServer())
      .get(`${signedUrl.pathname}${signedUrl.search}`)
      .expect(200)
      .expect("Content-Type", "image/png");

    const otherList = await request(app.getHttpServer())
      .get(`/api/organizations/${otherOwner.body.organizationId}/media-assets`)
      .set("Authorization", otherAuth)
      .expect(200);
    expect(otherList.body.total).toBe(0);
    await request(app.getHttpServer())
      .get(`/api/organizations/${otherOwner.body.organizationId}/media-assets/${asset.id}`)
      .set("Authorization", otherAuth)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/organizations/${otherOwner.body.organizationId}/media-assets/${asset.id}`)
      .set("Authorization", otherAuth)
      .expect(404);

    const connection = await request(app.getHttpServer())
      .post(`/api/organizations/${owner.body.organizationId}/instagram/accounts/connect`)
      .set("Authorization", ownerAuth)
      .expect(201);
    const accountResponse = await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({ state: connection.body.state, code: `media-${suffix}` })
      .expect(200);
    const publication = await request(app.getHttpServer())
      .post(`/api/organizations/${owner.body.organizationId}/instagram/publications`)
      .set("Authorization", ownerAuth)
      .send({
        instagramAccountId: accountResponse.body.id,
        mediaType: PublicationMediaType.PHOTO,
        mediaAssetId: asset.id,
        caption: "Published from the local media library",
        idempotencyKey: `media-${suffix}`,
      })
      .expect(201);
    createdPublicationIds.push(publication.body.id);
    expect(publication.body).toMatchObject({
      mediaAssetId: asset.id,
      status: "DRAFT",
    });
    expect(publication.body).not.toHaveProperty("mediaUrl");

    await request(app.getHttpServer())
      .delete(`${assetsPath}/${asset.id}`)
      .set("Authorization", ownerAuth)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/organizations/${owner.body.organizationId}/instagram/publications/${publication.body.id}/publish`)
      .set("Authorization", ownerAuth)
      .expect(202);
    const published = await waitForPublished(
      app.getHttpServer(),
      `/api/organizations/${owner.body.organizationId}/instagram/publications`,
      publication.body.id,
      ownerAuth,
    );
    expect(published).toMatchObject({
      status: "PUBLISHED",
      mediaAssetId: asset.id,
      externalMediaId: expect.stringMatching(/^mock-media-photo-/),
    });

    await request(app.getHttpServer())
      .delete(`${assetsPath}/${asset.id}`)
      .set("Authorization", ownerAuth)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: asset.id, deleted: true }));
    expect(await prisma.publication.findUnique({ where: { id: publication.body.id } })).toMatchObject({
      mediaAssetId: null,
    });
    await request(app.getHttpServer())
      .get(`${assetsPath}/${asset.id}`)
      .set("Authorization", ownerAuth)
      .expect(404);
  });

  async function register(email: string, organizationName: string) {
    createdUserEmails.push(email);
    return request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email,
        password: "strong-test-password-media-123",
        organizationName,
      })
      .expect(201);
  }
});

function pngFixture(width: number, height: number): Buffer {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

async function waitForPublished(
  server: ReturnType<INestApplication["getHttpServer"]>,
  collectionPath: string,
  publicationId: string,
  authorization: string,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await request(server)
      .get(`${collectionPath}/${publicationId}`)
      .set("Authorization", authorization);
    if (response.status !== 200) {
      throw new Error(`Publication status endpoint returned ${response.status}`);
    }
    if (response.body.status === "PUBLISHED") return response.body;
    if (response.body.status === "FAILED") {
      throw new Error(`MOCK publication failed: ${response.body.errorCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for MOCK publication");
}
