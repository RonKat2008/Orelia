// Client-side re-exports: types only, so no server code or zod schemas reach the bundle.
export type {
  Board,
  BoardItem,
  ConsultProcess,
  ConsultRequest,
  ConsultStatus,
  Doctor,
  PacketSection,
  PacketSectionKey,
  ReferralRequirement,
  RequirementKind,
  RequirementStatus,
  RequirementsChecklist,
  ReviewView,
  SpecialistPacket,
} from '@/lib/coordination/contract';

export interface ConsentField { key: string; label: string }
/** A chosen specialist/center, from the contact plan. */
export interface Resource { resourceKey: string; name: string; contactId: string | null }
export interface ContactOption { id: string; targetKind: string; targetId: string; displayName: string }
