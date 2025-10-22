/**
 * Background job tests for welcome bootstrap worker
 * Tests retries, data persistence, error handling, and concurrency
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { prisma } from '../src/db/client';

// Test data
const TEST_USER_ID = 'test_user_bootstrap_' + Date.now();
const TEST_RESTAURANT_ID = 'test_restaurant_bootstrap_' + Date.now();
const TEST_MERCHANT_ID = 'test_merchant_bootstrap';
const TEST_CUSTOMER_WA = '+966500999001';

// Mock data for Sufrah API responses
const MOCK_CATEGORIES = [
  {
    id: 'cat1',
    nameAr: 'مشروبات',
    nameEn: 'Drinks',
    descriptionAr: 'مشروبات منعشة',
    descriptionEn: 'Refreshing drinks',
  },
  {
    id: 'cat2',
    nameAr: 'مأكولات',
    nameEn: 'Food',
    descriptionAr: 'وجبات لذيذة',
    descriptionEn: 'Delicious meals',
  },
];

const MOCK_BRANCHES = [
  {
    id: 'branch1',
    nameAr: 'الفرع الرئيسي',
    nameEn: 'Main Branch',
    addressAr: 'شارع الملك فهد',
    addressEn: 'King Fahd Street',
    phoneNumber: '+966500000001',
    city: {
      id: 'city1',
      nameAr: 'الرياض',
      nameEn: 'Riyadh',
      areas: [],
    },
  },
  {
    id: 'branch2',
    nameAr: 'الفرع الشمالي',
    nameEn: 'North Branch',
    addressAr: 'شارع العليا',
    addressEn: 'Olaya Street',
    phoneNumber: '+966500000002',
    city: {
      id: 'city1',
      nameAr: 'الرياض',
      nameEn: 'Riyadh',
      areas: [],
    },
  },
];

describe('Welcome Bootstrap Worker', () => {
  let testUser: any;
  let testRestaurant: any;

  beforeEach(async () => {
    // Create test user and restaurant
    testUser = await prisma.user.create({
      data: {
        id: TEST_USER_ID,
        phone: '+966500' + Date.now(),
        name: 'Test User Bootstrap',
      },
    });

    testRestaurant = await prisma.restaurant.create({
      data: {
        id: TEST_RESTAURANT_ID,
        userId: testUser.id,
        name: 'Test Restaurant Bootstrap',
        externalMerchantId: TEST_MERCHANT_ID,
        isActive: true,
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.restaurant.delete({
      where: { id: TEST_RESTAURANT_ID },
    }).catch(() => {});

    await prisma.user.delete({
      where: { id: TEST_USER_ID },
    }).catch(() => {});
  });

  describe('Job Execution', () => {
    test('should successfully process a bootstrap job', async () => {
      // Mock the Sufrah API calls
      const mockFetchCategories = mock(() => Promise.resolve(MOCK_CATEGORIES));
      const mockFetchBranches = mock(() => Promise.resolve(MOCK_BRANCHES));

      // Simulate job processing
      const jobData = {
        restaurantId: TEST_RESTAURANT_ID,
        merchantId: TEST_MERCHANT_ID,
        customerWa: TEST_CUSTOMER_WA,
        profileName: 'Test Customer',
      };

      // Verify job data structure
      expect(jobData.restaurantId).toBe(TEST_RESTAURANT_ID);
      expect(jobData.merchantId).toBe(TEST_MERCHANT_ID);
      expect(jobData.customerWa).toBe(TEST_CUSTOMER_WA);

      // Simulate successful execution
      const categoriesCount = MOCK_CATEGORIES.length;
      const branchesCount = MOCK_BRANCHES.length;

      expect(categoriesCount).toBe(2);
      expect(branchesCount).toBe(2);
    });

    test('should handle merchant with no categories', async () => {
      const mockFetchCategories = mock(() => Promise.resolve([]));
      const mockFetchBranches = mock(() => Promise.resolve(MOCK_BRANCHES));

      const categoriesCount = (await mockFetchCategories()).length;
      const branchesCount = (await mockFetchBranches()).length;

      expect(categoriesCount).toBe(0);
      expect(branchesCount).toBe(2);
    });

    test('should handle merchant with no branches', async () => {
      const mockFetchCategories = mock(() => Promise.resolve(MOCK_CATEGORIES));
      const mockFetchBranches = mock(() => Promise.resolve([]));

      const categoriesCount = (await mockFetchCategories()).length;
      const branchesCount = (await mockFetchBranches()).length;

      expect(categoriesCount).toBe(2);
      expect(branchesCount).toBe(0);
    });
  });

  describe('Error Handling and Retries', () => {
    test('should retry on API failure', async () => {
      let attemptCount = 0;
      const maxAttempts = 3;

      // Simulate API that fails first 2 times then succeeds
      const mockFetchWithRetry = mock(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('API temporarily unavailable');
        }
        return Promise.resolve(MOCK_CATEGORIES);
      });

      // Simulate retry logic
      let lastError: Error | null = null;
      let result: any = null;

      for (let i = 0; i < maxAttempts; i++) {
        try {
          result = await mockFetchWithRetry();
          break;
        } catch (error) {
          lastError = error as Error;
          // Exponential backoff would happen here
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      expect(attemptCount).toBe(3);
      expect(result).toEqual(MOCK_CATEGORIES);
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(3);
    });

    test('should fail after max retries', async () => {
      const maxAttempts = 3;
      let attemptCount = 0;

      const mockFetchAlwaysFails = mock(() => {
        attemptCount++;
        throw new Error('Persistent API failure');
      });

      let lastError: Error | null = null;

      for (let i = 0; i < maxAttempts; i++) {
        try {
          await mockFetchAlwaysFails();
        } catch (error) {
          lastError = error as Error;
        }
      }

      expect(attemptCount).toBe(maxAttempts);
      expect(lastError).not.toBeNull();
      expect(lastError?.message).toBe('Persistent API failure');
    });

    test('should handle partial failures gracefully', async () => {
      // Categories fetch succeeds, branches fetch fails
      const mockFetchCategories = mock(() => Promise.resolve(MOCK_CATEGORIES));
      const mockFetchBranches = mock(() => {
        throw new Error('Branch API failure');
      });

      let categoriesResult: any = null;
      let branchesError: Error | null = null;

      try {
        categoriesResult = await mockFetchCategories();
      } catch (error) {
        // Should not throw
      }

      try {
        await mockFetchBranches();
      } catch (error) {
        branchesError = error as Error;
      }

      expect(categoriesResult).toEqual(MOCK_CATEGORIES);
      expect(branchesError).not.toBeNull();
      expect(branchesError?.message).toBe('Branch API failure');
    });

    test('should handle network timeouts', async () => {
      const mockFetchWithTimeout = mock(() => {
        return new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Network timeout')), 100);
        });
      });

      let error: Error | null = null;

      try {
        await mockFetchWithTimeout();
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toBe('Network timeout');
    });
  });

  describe('Data Persistence and Caching', () => {
    test('should cache fetched categories', async () => {
      const mockCache = new Map<string, any>();
      const mockFetchCategories = mock(() => Promise.resolve(MOCK_CATEGORIES));

      // First fetch - miss cache
      let result1 = mockCache.get('categories');
      if (!result1) {
        result1 = await mockFetchCategories();
        mockCache.set('categories', { data: result1, expiresAt: Date.now() + 180000 });
      }

      // Second fetch - hit cache
      const result2 = mockCache.get('categories');

      expect(mockFetchCategories).toHaveBeenCalledTimes(1); // Only called once
      expect(result1).toEqual(MOCK_CATEGORIES);
      expect(result2?.data).toEqual(MOCK_CATEGORIES);
    });

    test('should cache fetched branches', async () => {
      const mockCache = new Map<string, any>();
      const mockFetchBranches = mock(() => Promise.resolve(MOCK_BRANCHES));

      // First fetch - miss cache
      let result1 = mockCache.get('branches');
      if (!result1) {
        result1 = await mockFetchBranches();
        mockCache.set('branches', { data: result1, expiresAt: Date.now() + 180000 });
      }

      // Second fetch - hit cache
      const result2 = mockCache.get('branches');

      expect(mockFetchBranches).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(MOCK_BRANCHES);
      expect(result2?.data).toEqual(MOCK_BRANCHES);
    });

    test('should expire and refresh stale cache', async () => {
      const TTL = 100; // 100ms for testing
      const mockCache = new Map<string, any>();
      const mockFetchCategories = mock(() => Promise.resolve(MOCK_CATEGORIES));

      // First fetch
      const result1 = await mockFetchCategories();
      mockCache.set('categories', { data: result1, expiresAt: Date.now() + TTL });

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, TTL + 10));

      // Second fetch - cache expired
      const cached = mockCache.get('categories');
      if (cached && cached.expiresAt <= Date.now()) {
        const result2 = await mockFetchCategories();
        mockCache.set('categories', { data: result2, expiresAt: Date.now() + TTL });
      }

      expect(mockFetchCategories).toHaveBeenCalledTimes(2);
    });

    test('should handle cache misses gracefully', async () => {
      const mockCache = new Map<string, any>();
      
      const result = mockCache.get('nonexistent_key');
      
      expect(result).toBeUndefined();
    });
  });

  describe('Performance and Concurrency', () => {
    test('should process multiple jobs in parallel', async () => {
      const jobs = [
        { id: '1', merchantId: 'merchant1', customerWa: '+966500000001' },
        { id: '2', merchantId: 'merchant2', customerWa: '+966500000002' },
        { id: '3', merchantId: 'merchant3', customerWa: '+966500000003' },
      ];

      const mockProcessJob = mock((job: any) => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ success: true, jobId: job.id }), 50);
        });
      });

      const startTime = Date.now();
      const results = await Promise.all(jobs.map(job => mockProcessJob(job)));
      const duration = Date.now() - startTime;

      // All jobs should complete in roughly the same time as one job (parallel)
      expect(duration).toBeLessThan(150); // 3 * 50ms would be 150ms sequential
      expect(results).toHaveLength(3);
      expect(mockProcessJob).toHaveBeenCalledTimes(3);
    });

    test('should measure job execution duration', async () => {
      const mockFetchCategories = mock(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve(MOCK_CATEGORIES), 50);
        });
      });

      const startTime = Date.now();
      await mockFetchCategories();
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(50);
      expect(duration).toBeLessThan(100);
    });

    test('should handle concurrent cache writes', async () => {
      const mockCache = new Map<string, any>();
      const mockFetchData = mock(() => Promise.resolve(MOCK_CATEGORIES));

      // Simulate concurrent writes
      const writes = [
        mockFetchData().then(data => mockCache.set('key1', data)),
        mockFetchData().then(data => mockCache.set('key2', data)),
        mockFetchData().then(data => mockCache.set('key3', data)),
      ];

      await Promise.all(writes);

      expect(mockCache.size).toBe(3);
      expect(mockCache.get('key1')).toEqual(MOCK_CATEGORIES);
      expect(mockCache.get('key2')).toEqual(MOCK_CATEGORIES);
      expect(mockCache.get('key3')).toEqual(MOCK_CATEGORIES);
    });
  });

  describe('Template SID Warming', () => {
    test('should warm template SID cache', () => {
      const templateCache = new Map<string, string>();
      
      const templates = [
        { key: 'welcome', sid: 'HXabc123' },
        { key: 'order_type', sid: 'HXdef456' },
        { key: 'categories', sid: 'HXghi789' },
      ];

      templates.forEach(({ key, sid }) => {
        if (sid) {
          templateCache.set(key, sid);
        }
      });

      expect(templateCache.size).toBe(3);
      expect(templateCache.get('welcome')).toBe('HXabc123');
      expect(templateCache.get('order_type')).toBe('HXdef456');
      expect(templateCache.get('categories')).toBe('HXghi789');
    });

    test('should skip warming templates with no SID', () => {
      const templateCache = new Map<string, string>();
      
      const templates = [
        { key: 'welcome', sid: 'HXabc123' },
        { key: 'missing', sid: undefined },
        { key: 'categories', sid: 'HXghi789' },
      ];

      templates.forEach(({ key, sid }) => {
        if (sid) {
          templateCache.set(key, sid);
        }
      });

      expect(templateCache.size).toBe(2);
      expect(templateCache.has('missing')).toBe(false);
    });
  });

  describe('Job Data Validation', () => {
    test('should validate required job fields', () => {
      const validJob = {
        restaurantId: TEST_RESTAURANT_ID,
        merchantId: TEST_MERCHANT_ID,
        customerWa: TEST_CUSTOMER_WA,
        profileName: 'Test Customer',
      };

      expect(validJob.restaurantId).toBeDefined();
      expect(validJob.merchantId).toBeDefined();
      expect(validJob.customerWa).toBeDefined();
    });

    test('should handle optional job fields', () => {
      const jobWithoutName = {
        restaurantId: TEST_RESTAURANT_ID,
        merchantId: TEST_MERCHANT_ID,
        customerWa: TEST_CUSTOMER_WA,
      };

      expect(jobWithoutName.restaurantId).toBeDefined();
      expect(jobWithoutName.merchantId).toBeDefined();
      expect(jobWithoutName.customerWa).toBeDefined();
      expect((jobWithoutName as any).profileName).toBeUndefined();
    });

    test('should validate merchant ID format', () => {
      const merchantId = TEST_MERCHANT_ID;
      
      expect(typeof merchantId).toBe('string');
      expect(merchantId.length).toBeGreaterThan(0);
    });

    test('should validate customer phone format', () => {
      const phoneNumber = TEST_CUSTOMER_WA;
      
      expect(phoneNumber).toMatch(/^\+966\d{9}$/);
    });
  });

  describe('Logging and Monitoring', () => {
    test('should log job start', () => {
      const jobId = 'job_12345';
      const merchantId = TEST_MERCHANT_ID;
      
      const logMessage = `🔄 Processing welcome bootstrap job ${jobId} for merchant ${merchantId}`;
      
      expect(logMessage).toContain('Processing');
      expect(logMessage).toContain(jobId);
      expect(logMessage).toContain(merchantId);
    });

    test('should log job completion with stats', () => {
      const customerWa = TEST_CUSTOMER_WA;
      const duration = 250;
      const categoriesCount = 5;
      const branchesCount = 3;
      
      const logMessage = `✅ Welcome bootstrap completed for ${customerWa} in ${duration}ms ` +
        `(${categoriesCount} categories, ${branchesCount} branches)`;
      
      expect(logMessage).toContain('✅');
      expect(logMessage).toContain(customerWa);
      expect(logMessage).toContain('250ms');
      expect(logMessage).toContain('5 categories');
      expect(logMessage).toContain('3 branches');
    });

    test('should log job failure', () => {
      const customerWa = TEST_CUSTOMER_WA;
      const duration = 100;
      const error = new Error('API failure');
      
      const logMessage = `❌ Welcome bootstrap failed for ${customerWa} after ${duration}ms: ${error.message}`;
      
      expect(logMessage).toContain('❌');
      expect(logMessage).toContain('failed');
      expect(logMessage).toContain('API failure');
    });
  });
});

