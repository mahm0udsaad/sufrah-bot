-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED');

-- AlterTable
ALTER TABLE "RestaurantProfile" ADD COLUMN     "status" "OnboardingStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN     "twilio_account_sid" TEXT,
ADD COLUMN     "twilio_auth_token" TEXT;
