import { z } from "zod";

export const rewardCampaignTopUpSchema = z.object({ amount: z.number().int().positive().max(100_000) });
