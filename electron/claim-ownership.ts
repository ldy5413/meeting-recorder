import type { Claim } from "../shared/types";
import { isAnonymousSpeakerLabel } from "../shared/speakers";

export interface OwnerAdjustment {
  claimIndex: number;
  originalOwner: string;
  owner: null;
  reason: "anonymous-speaker-label";
}

/** Remove only placeholder identities; retain the action and its speech evidence for review. */
export function normalizeAnonymousOwners(claims: Claim[]) {
  const ownerAdjustments: OwnerAdjustment[] = [];
  return {
    claims: claims.map((claim, claimIndex) => {
      if (!claim.owner || !isAnonymousSpeakerLabel(claim.owner)) return claim;
      ownerAdjustments.push({
        claimIndex,
        originalOwner: claim.owner,
        owner: null,
        reason: "anonymous-speaker-label",
      });
      return { ...claim, owner: null };
    }),
    ownerAdjustments,
  };
}
