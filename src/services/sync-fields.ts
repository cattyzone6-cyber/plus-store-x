/**
 * Store product fields that catalog sync copies from the product's primary provider
 * source (when products.auto_sync_info = true). As soon as an admin edits one of these
 * fields in the panel, it is added to products.locked_fields and sync never touches it
 * again (until the admin clicks "reset to provider", which removes the lock).
 * Prices and stock are never copied: they are always computed live from the sources.
 */
export const SYNCABLE_FIELDS = ['name_en', 'description_en', 'image_url', 'warranty_days', 'emoji'] as const;
export type SyncableField = (typeof SYNCABLE_FIELDS)[number];
