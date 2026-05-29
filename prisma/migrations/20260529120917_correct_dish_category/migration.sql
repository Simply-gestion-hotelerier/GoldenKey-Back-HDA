/*
  Warnings:

  - The values [dejeuner] on the enum `DishCategory` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "DishCategory_new" AS ENUM ('breakfast', 'appetizer', 'main_course', 'dessert', 'beverage', 'side_dish', 'lunch', 'snack');
ALTER TABLE "Dish" ALTER COLUMN "category" TYPE "DishCategory_new" USING ("category"::text::"DishCategory_new");
ALTER TYPE "DishCategory" RENAME TO "DishCategory_old";
ALTER TYPE "DishCategory_new" RENAME TO "DishCategory";
DROP TYPE "DishCategory_old";
COMMIT;
