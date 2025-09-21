export const MAX_ITEM_QUANTITY = 20;

export const FOOD_CATEGORIES = [
  { id: 'cat_main', item: '🍴 الأطباق الرئيسية', description: 'شاورما وبرجر' },
  { id: 'cat_appetizers', item: '🥗 المقبلات', description: 'أطباق جانبية طازجة' },
  { id: 'cat_drinks', item: '🥤 المشروبات', description: 'مشروبات باردة وساخنة' },
];

export const CATEGORY_ITEMS: Record<string, Array<{ id: string; item: string; description?: string; image: string; price: number; currency?: string }>> = {
  cat_main: [
    {
      id: 'item_main_beef_shawarma',
      item: 'شاورما لحم',
      description: 'شاورما لحم بصوص الطحينة',
      price: 20,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2017/03/17/14/11/shawarma-2150547_1280.jpg',
    },
    {
      id: 'item_main_chicken_shawarma',
      item: 'شاورما دجاج',
      description: 'دجاج متبل مع صوص الثوم',
      price: 18,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2016/11/20/08/39/dish-1840971_1280.jpg',
    },
    {
      id: 'item_main_beef_burger',
      item: 'برجر لحم',
      description: 'برجر بقري مشوي مع جبنة',
      price: 25,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2014/10/23/18/05/burger-500054_1280.jpg',
    },
    {
      id: 'item_main_chicken_burger',
      item: 'برجر دجاج',
      description: 'برجر دجاج مقرمش مع صلصة خاصة',
      price: 22,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2018/03/12/19/39/avocado-3226331_1280.jpg',
    },
  ],
  cat_appetizers: [
    {
      id: 'item_app_fries',
      item: 'بطاطس مقلية',
      description: 'مقرمشة ومتبلّة',
      price: 12,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2016/04/19/12/55/french-fries-1331040_1280.jpg',
    },
    {
      id: 'item_app_hummus',
      item: 'حمص بالطحينة',
      description: 'يقدم مع خبز عربي',
      price: 15,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2014/12/02/22/03/hummus-554943_1280.jpg',
    },
    {
      id: 'item_app_falafel',
      item: 'فلافل',
      description: 'كرات فلافل طازجة',
      price: 14,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2018/08/15/14/16/falafel-3609312_1280.jpg',
    },
  ],
  cat_drinks: [
    {
      id: 'item_drink_mint_lemonade',
      item: 'ليمون بالنعناع',
      description: 'عصير طازج ومنعش',
      price: 10,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2017/06/23/15/12/lemonade-2438947_1280.jpg',
    },
    {
      id: 'item_drink_cola',
      item: 'مشروب غازي',
      description: 'علبة مبردة',
      price: 6,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2017/08/19/07/51/coca-cola-2650497_1280.jpg',
    },
    {
      id: 'item_drink_water',
      item: 'ماء',
      description: 'قارورة 500 مل',
      price: 4,
      currency: 'ر.س',
      image: 'https://cdn.pixabay.com/photo/2017/05/31/08/34/drink-2358695_1280.jpg',
    },
  ],
};

export function findCategoryById(categoryId: string) {
  return FOOD_CATEGORIES.find((c) => c.id === categoryId);
}

export function findItemById(itemId: string) {
  for (const [categoryId, items] of Object.entries(CATEGORY_ITEMS)) {
    const found = items.find((i) => i.id === itemId);
    if (found) return { categoryId, item: found };
  }
  return undefined;
}

export const PICKUP_BRANCHES = [
  {
    id: 'branch_central',
    item: '🏢 فرع المركز',
    description: 'الرياض - حي العليا، شارع الملك فهد',
  },
  {
    id: 'branch_west',
    item: '🏢 فرع الغرب',
    description: 'الرياض - حي طويق، طريق مكة المكرمة',
  },
  {
    id: 'branch_east',
    item: '🏢 فرع الشرق',
    description: 'الرياض - حي اليرموك، طريق الإمام عبدالله بن سعود',
  },
];

export function findBranchById(branchId: string) {
  return PICKUP_BRANCHES.find((branch) => branch.id === branchId);
}

export function findBranchByText(input: string) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;

  const numeric = Number.parseInt(normalized, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= PICKUP_BRANCHES.length) {
    return PICKUP_BRANCHES[numeric - 1];
  }

  return PICKUP_BRANCHES.find((branch) => {
    const nameNormalized = branch.item.toLowerCase();
    const descNormalized = branch.description.toLowerCase();
    return nameNormalized.includes(normalized) || descNormalized.includes(normalized);
  });
}
