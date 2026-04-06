-- Step 0 ingestion: link additional and reference images to ingestion records

CREATE TABLE IF NOT EXISTS step0_ingestion_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_id uuid NOT NULL REFERENCES step0_ingestions(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  role text NOT NULL,  -- 'additional_photo' | 'reference_image'
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingestion_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_step0_ingestion_images_ingestion ON step0_ingestion_images(ingestion_id);
CREATE INDEX IF NOT EXISTS idx_step0_ingestion_images_asset ON step0_ingestion_images(asset_id);
