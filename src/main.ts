import "dotenv/config";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
    bodyParser: false,
  });
  app.useBodyParser("json", { limit: "2mb" });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const config = app.get(ConfigService);
  app.set("trust proxy", config.get<number>("TRUST_PROXY_HOPS", 0));
  const configuredOrigins = config.get<string>("CORS_ORIGIN", "http://localhost:3000");
  const origins = configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.includes("*") ? "*" : origins,
    credentials: !origins.includes("*"),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Correlation-ID"],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Instagram Automation Platform API")
    .setDescription(
      "Backend foundation API with tenant-scoped Instagram professional account connections.",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "docs-json",
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
