CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "moment_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"moment_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"embedding_type" text NOT NULL,
	"source_text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moment_embeddings_type_check" CHECK ("moment_embeddings"."embedding_type" in ('VISUAL','MEME','NARRATIVE'))
);
--> statement-breakpoint
ALTER TABLE "moment_embeddings" ADD CONSTRAINT "moment_embeddings_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_embeddings" ADD CONSTRAINT "moment_embeddings_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moment_embeddings_unique" ON "moment_embeddings" USING btree ("moment_id","embedding_type","model","model_version");--> statement-breakpoint
CREATE INDEX "moment_embeddings_asset_idx" ON "moment_embeddings" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "moment_embeddings_cosine_idx" ON "moment_embeddings" USING hnsw ("embedding" vector_cosine_ops);