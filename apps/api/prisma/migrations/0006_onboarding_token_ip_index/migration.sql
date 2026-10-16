-- Drop the unique constraint on tunnelIp for OnboardingToken so expired/rotated IPs can be reallocated
DROP INDEX IF EXISTS "OnboardingToken_tunnelIp_key";

-- Create index on tunnelIp for query performance
CREATE INDEX IF NOT EXISTS "OnboardingToken_tunnelIp_idx" ON "OnboardingToken"("tunnelIp");
