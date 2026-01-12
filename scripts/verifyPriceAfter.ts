#!/usr/bin/env bun
/**
 * Script to verify that priceAfter field exists in Sufrah API product responses
 * Usage: bun run scripts/verifyPriceAfter.ts [merchantId] [branchId]
 */

import { fetchMerchantCategories, fetchCategoryProducts } from '../src/services/sufrahApi';

async function main() {
  const merchantId = process.argv[2] || process.env.TEST_MERCHANT_ID;
  const branchId = process.argv[3] || process.env.TEST_BRANCH_ID;

  if (!merchantId) {
    console.error('❌ Error: merchantId is required');
    console.error('Usage: bun run scripts/verifyPriceAfter.ts <merchantId> <branchId>');
    console.error('Or set TEST_MERCHANT_ID and TEST_BRANCH_ID environment variables');
    process.exit(1);
  }

  if (!branchId) {
    console.error('❌ Error: branchId is required');
    console.error('Usage: bun run scripts/verifyPriceAfter.ts <merchantId> <branchId>');
    process.exit(1);
  }

  console.log(`\n🔍 Verifying priceAfter field for merchant: ${merchantId}, branch: ${branchId}\n`);

  try {
    // Fetch categories
    console.log('📂 Fetching categories...');
    const categories = await fetchMerchantCategories(merchantId);
    console.log(`✅ Found ${categories.length} categories\n`);

    if (categories.length === 0) {
      console.warn('⚠️  No categories found for this merchant');
      return;
    }

    // Check products from first category
    const firstCategory = categories[0];
    console.log(`📦 Fetching products from category: ${firstCategory.nameAr || firstCategory.nameEn || firstCategory.id}`);
    
    const products = await fetchCategoryProducts(firstCategory.id, branchId);
    console.log(`✅ Found ${products.length} products\n`);

    if (products.length === 0) {
      console.warn('⚠️  No products found in this category');
      return;
    }

    // Analyze products
    let productsWithPriceAfter = 0;
    let productsWithDiscount = 0;
    const sampleProducts: Array<{
      name: string;
      price: any;
      priceAfter: any;
      hasDiscount: boolean;
    }> = [];

    products.forEach((product) => {
      const hasPriceAfter = product.priceAfter !== null && product.priceAfter !== undefined;
      if (hasPriceAfter) {
        productsWithPriceAfter++;
      }

      const price = typeof product.price === 'string' ? parseFloat(product.price) : product.price;
      const priceAfter = typeof product.priceAfter === 'string' ? parseFloat(product.priceAfter) : product.priceAfter;
      const hasDiscount = hasPriceAfter && priceAfter < price;
      
      if (hasDiscount) {
        productsWithDiscount++;
      }

      // Collect first 5 products for detailed output
      if (sampleProducts.length < 5) {
        sampleProducts.push({
          name: product.nameAr || product.nameEn || product.id,
          price: product.price,
          priceAfter: product.priceAfter,
          hasDiscount,
        });
      }
    });

    // Summary
    console.log('📊 Summary:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Products with priceAfter field: ${productsWithPriceAfter} (${((productsWithPriceAfter / products.length) * 100).toFixed(1)}%)`);
    console.log(`   Products with actual discount: ${productsWithDiscount} (${((productsWithDiscount / products.length) * 100).toFixed(1)}%)`);
    console.log();

    // Sample products
    console.log('📋 Sample products:');
    sampleProducts.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name}`);
      console.log(`      price: ${product.price}`);
      console.log(`      priceAfter: ${product.priceAfter || 'null/undefined'}`);
      console.log(`      hasDiscount: ${product.hasDiscount ? '✅ YES' : '❌ NO'}`);
      console.log();
    });

    // Conclusion
    if (productsWithPriceAfter > 0) {
      console.log('✅ SUCCESS: priceAfter field is present in API responses');
      if (productsWithDiscount > 0) {
        console.log(`✅ Found ${productsWithDiscount} product(s) with active discounts (priceAfter < price)`);
      } else {
        console.log('ℹ️  Note: priceAfter field exists but no active discounts found in this sample');
      }
    } else {
      console.log('⚠️  WARNING: No products with priceAfter field found');
      console.log('   This might be expected if no products currently have discounts');
    }

  } catch (error) {
    console.error('❌ Error during verification:', error);
    process.exit(1);
  }
}

main();
