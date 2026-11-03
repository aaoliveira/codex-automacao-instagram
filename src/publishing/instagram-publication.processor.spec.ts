import { TokenEncryptionService } from "../instagram/token-encryption.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  InstagramPublishingProvider,
  InstagramPublishingProviderError,
} from "./instagram-publishing-provider";
import { InstagramPublicationProcessor } from "./instagram-publication.processor";
import { DelayedError } from "bullmq";

const jobData = {
  publicationId: "publication-1",
  organizationId: "organization-1",
};
const publication = {
  id: jobData.publicationId,
  organizationId: jobData.organizationId,
  instagramAccountId: "account-1",
  mediaType: "PHOTO",
  mediaUrl: "https://cdn.example.test/photo.jpg",
  caption: "A photo",
  altText: null,
  shareToFeed: null,
  status: "PROCESSING",
  externalContainerId: "remote-container-1" as string | null,
  externalMediaId: null,
  publishAttemptedAt: new Date() as Date | null,
  instagramAccount: {
    id: "account-1",
    provider: "MOCK",
    status: "CONNECTED",
    externalAccountId: "mock-account-1",
    encryptedAccessToken: "ciphertext",
    accessTokenIv: "iv",
    accessTokenTag: "tag",
  },
};

describe("InstagramPublicationProcessor", () => {

  it("reconciles an already published container without issuing another publish call", async () => {
    const prisma = fakePrisma(publication);
    const provider = {
      type: "MOCK",
      getContainerStatus: jest.fn().mockResolvedValue("PUBLISHED"),
      publishContainer: jest.fn(),
      createContainer: jest.fn(),
    } as unknown as InstagramPublishingProvider;
    const processor = createProcessor(prisma, provider);

    await processor.process(fakeJob());

    expect(provider.getContainerStatus).toHaveBeenCalledWith(
      {
        externalAccountId: "mock-account-1",
        accessToken: "decrypted-token",
      },
      "remote-container-1",
    );
    expect(provider.publishContainer).not.toHaveBeenCalled();
    expect(provider.createContainer).not.toHaveBeenCalled();
    expect(prisma.publication.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PUBLISHED",
          externalMediaId: null,
        }),
      }),
    );
  });

  it("requeues transient provider errors, while retaining the existing container", async () => {
    const prisma = fakePrisma({
      ...publication,
      externalContainerId: null,
      publishAttemptedAt: null,
    });
    const provider = {
      type: "MOCK",
      createContainer: jest
        .fn()
        .mockRejectedValue(
          new InstagramPublishingProviderError("META_NETWORK_ERROR", true),
        ),
    } as unknown as InstagramPublishingProvider;
    const processor = createProcessor(prisma, provider);

    await expect(processor.process(fakeJob())).rejects.toMatchObject({
      code: "META_NETWORK_ERROR",
      retryable: true,
    });
    expect(prisma.publication.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUEUED",
          errorCode: "META_NETWORK_ERROR",
        }),
      }),
    );
  });

  it("delays a rate-limited job without claiming or failing the publication", async () => {
    const prisma = fakePrisma(publication);
    const provider = { type: "MOCK" } as unknown as InstagramPublishingProvider;
    const processor = createProcessor(prisma, provider, 2_500);
    const job = fakeJob() as { moveToDelayed: jest.Mock };

    await expect(processor.process(job as never)).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "lock-token");
    expect(prisma.publication.updateMany).not.toHaveBeenCalled();
    expect(provider.createContainer).toBeUndefined();
  });
});

function fakePrisma(publicationRecord: typeof publication) {
  return {
    publication: {
      findFirst: jest.fn().mockResolvedValue({
        status: "QUEUED",
        instagramAccountId: publicationRecord.instagramAccount.id,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: jest.fn().mockResolvedValue(publicationRecord),
    },
  } as unknown as PrismaService;
}

function createProcessor(
  prisma: PrismaService,
  provider: InstagramPublishingProvider,
  rateLimitWaitMs = 0,
) {
  const encryption = {
    decrypt: jest.fn().mockReturnValue("decrypted-token"),
  } as unknown as TokenEncryptionService;
  return new InstagramPublicationProcessor(
    prisma,
    encryption,
    provider,
    {} as never,
    { consume: jest.fn().mockResolvedValue(rateLimitWaitMs) } as never,
  );
}

function fakeJob() {
  return {
    data: jobData,
    attemptsMade: 0,
    opts: { attempts: 3 },
    token: "lock-token",
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  } as never;
}

