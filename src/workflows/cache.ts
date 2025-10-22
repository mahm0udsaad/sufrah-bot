import { findContentTemplateCache, touchContentTemplateCache, upsertContentTemplateCache } from '../db/contentTemplateCache';
import { rememberTemplateText, registerTemplateTextForKey, registerTemplateTextForSid } from './templateText';
import { recordCacheHit, recordCacheMiss, recordCacheCreation } from '../services/templateCacheMetrics';

const contentSidCache = new Map<string, string>();
const DEFAULT_SIGNATURE = '__DEFAULT__';

function buildCacheKey(key: string, dataHash: string): string {
  return `${key}::${dataHash}`;
}

const CONTENT_OVERRIDES: Record<string, string | undefined> = {
  welcome: process.env.CONTENT_SID_WELCOME,
  order_type: process.env.CONTENT_SID_ORDER_TYPE,
  categories: process.env.CONTENT_SID_CATEGORIES,
  post_item_choice: process.env.CONTENT_SID_POST_ITEM_CHOICE,
  location_request: process.env.CONTENT_SID_LOCATION_REQUEST,
  quantity_prompt: process.env.CONTENT_SID_QUANTITY,
  cart_options: process.env.CONTENT_SID_CART_OPTIONS,
  payment_options: process.env.CONTENT_SID_PAYMENT_OPTIONS,
  branch_list: process.env.CONTENT_SID_BRANCH_LIST,
  rating_list: process.env.CONTENT_SID_RATING_LIST,
};

export function cacheContentSid(key: string, sid: string, dataSignature: string = DEFAULT_SIGNATURE) {
  contentSidCache.set(buildCacheKey(key, dataSignature), sid);
}

type ContentCreatorResult =
  | string
  | {
      sid: string;
      friendlyName?: string | null;
      metadata?: Record<string, unknown>;
    };

type ContentCreator = () => Promise<ContentCreatorResult>;

interface CacheOptions {
  dataSignature?: string;
  metadata?: Record<string, unknown>;
  friendlyName?: string | null;
  skipPersist?: boolean;
}

function extractResultDetails(
  result: ContentCreatorResult,
  fallbackFriendlyName?: string | null,
  fallbackMetadata?: Record<string, unknown>
): {
  sid: string;
  friendlyName: string | null;
  metadata: Record<string, unknown> | undefined;
} {
  if (typeof result === 'string') {
    return {
      sid: result,
      friendlyName: fallbackFriendlyName ?? null,
      metadata: fallbackMetadata,
    };
  }
  return {
    sid: result.sid,
    friendlyName: result.friendlyName ?? fallbackFriendlyName ?? null,
    metadata: result.metadata ?? fallbackMetadata,
  };
}

export async function getCachedContentSid(
  key: string,
  creator: ContentCreator,
  displayTextOrOptions?: string | CacheOptions,
  maybeOptions?: CacheOptions
): Promise<string> {
  let displayText: string | undefined;
  let options: CacheOptions | undefined;

  if (
    displayTextOrOptions &&
    typeof displayTextOrOptions === 'object' &&
    !Array.isArray(displayTextOrOptions)
  ) {
    options = displayTextOrOptions;
  } else {
    displayText = displayTextOrOptions as string | undefined;
    options = maybeOptions;
  }

  const dataSignature = options?.dataSignature ?? DEFAULT_SIGNATURE;
  const compositeKey = buildCacheKey(key, dataSignature);

  if (displayText) {
    registerTemplateTextForKey(key, displayText);
  }

  const hydrateTemplateText = (sid: string) => {
    if (displayText) {
      registerTemplateTextForSid(sid, displayText);
    }
    rememberTemplateText(key, sid);
  };

  // Check in-memory cache first
  if (contentSidCache.has(compositeKey)) {
    const sid = contentSidCache.get(compositeKey)!;
    hydrateTemplateText(sid);
    
    // Record cache hit (in-memory)
    recordCacheHit(key, dataSignature, sid, {
      source: 'memory',
      friendlyName: options?.friendlyName ?? undefined,
    });
    
    return sid;
  }

  // Check environment overrides
  const override = CONTENT_OVERRIDES[key];
  if (override) {
    cacheContentSid(key, override, dataSignature);
    hydrateTemplateText(override);
    
    // Record cache hit (override)
    recordCacheHit(key, dataSignature, override, {
      source: 'override',
      friendlyName: options?.friendlyName ?? undefined,
    });
    
    return override;
  }

  // Check database cache
  if (!options?.skipPersist) {
    const persisted = await findContentTemplateCache({ key, dataHash: dataSignature });
    if (persisted) {
      cacheContentSid(key, persisted.templateSid, dataSignature);
      hydrateTemplateText(persisted.templateSid);
      
      // Record cache hit (database)
      recordCacheHit(key, dataSignature, persisted.templateSid, {
        source: 'database',
        friendlyName: persisted.friendlyName ?? undefined,
        metadata: persisted.metadata,
      });
      
      await touchContentTemplateCache({ key, dataHash: dataSignature }).catch((error) => {
        console.warn(
          `⚠️ Failed to update content template cache usage timestamp for ${key}`,
          error
        );
      });
      return persisted.templateSid;
    }
  }
  
  // Record cache miss - will need to create new template
  recordCacheMiss(key, dataSignature, {
    friendlyName: options?.friendlyName ?? undefined,
    skipPersist: options?.skipPersist ?? false,
  });

  // Create new template
  const creationResult = await creator();
  const { sid, friendlyName, metadata } = extractResultDetails(
    creationResult,
    options?.friendlyName ?? null,
    options?.metadata
  );

  cacheContentSid(key, sid, dataSignature);
  hydrateTemplateText(sid);
  
  // Record template creation
  recordCacheCreation(key, dataSignature, sid, {
    friendlyName: friendlyName ?? undefined,
    metadata,
    skipPersist: options?.skipPersist ?? false,
  });

  if (!options?.skipPersist) {
    await upsertContentTemplateCache({
      key,
      dataHash: dataSignature,
      templateSid: sid,
      friendlyName,
      metadata,
    }).catch((error) => {
      console.warn(
        `⚠️ Failed to persist content template cache entry for ${key}`,
        error
      );
    });
  }

  return sid;
}

export function seedCacheFromKey(key: string, sid: string) {
  if (sid) {
    cacheContentSid(key, sid);
    rememberTemplateText(key, sid);
  }
}

export function exportCache() {
  return { contentSidCache, CONTENT_OVERRIDES };
}
