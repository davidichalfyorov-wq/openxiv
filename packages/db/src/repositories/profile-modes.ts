import { and, eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  profileModes,
  PROFILE_MODES,
  type ProfileMode,
  type ProfileModeRecord,
} from '../schema/profile-modes.js';

export { PROFILE_MODES } from '../schema/profile-modes.js';
export type { ProfileMode, ProfileModeRecord } from '../schema/profile-modes.js';

export interface ProfileModesRepository {
  /** Every row for a user, including modes they haven't enabled yet. */
  forUser(userId: string): AppResultAsync<ProfileModeRecord[]>;
  /** Only the public+enabled modes, for /u/{handle} rendering. */
  publicForUser(userId: string): AppResultAsync<ProfileModeRecord[]>;
  upsert(input: {
    userId: string;
    mode: ProfileMode;
    enabled: boolean;
    public: boolean;
    configJson?: Record<string, unknown> | null;
  }): AppResultAsync<ProfileModeRecord>;
  /** Seed all three modes for a new user, Reader default enabled+public. */
  seedDefaults(userId: string): AppResultAsync<void>;
}

export function makeProfileModesRepository(db: Database): ProfileModesRepository {
  return {
    forUser(userId) {
      return fromPromise(
        db.select().from(profileModes).where(eq(profileModes.userId, userId)),
        (cause) => Errors.internal('profileModes.forUser', cause),
      );
    },
    publicForUser(userId) {
      return fromPromise(
        db
          .select()
          .from(profileModes)
          .where(
            and(
              eq(profileModes.userId, userId),
              eq(profileModes.enabled, true),
              eq(profileModes.public, true),
            ),
          ),
        (cause) => Errors.internal('profileModes.publicForUser', cause),
      );
    },
    upsert(input) {
      if (!(PROFILE_MODES as readonly string[]).includes(input.mode)) {
        return fromPromise(
          Promise.reject(new Error(`invalid mode: ${input.mode}`)),
          (cause) => Errors.validation('invalid profile mode', cause),
        );
      }
      return fromPromise(
        db
          .insert(profileModes)
          .values({
            userId: input.userId,
            mode: input.mode,
            enabled: input.enabled,
            public: input.public,
            configJson: input.configJson ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [profileModes.userId, profileModes.mode],
            set: {
              enabled: input.enabled,
              public: input.public,
              configJson: input.configJson ?? null,
              updatedAt: new Date(),
            },
          })
          .returning(),
        (cause) => Errors.internal('profileModes.upsert', cause),
      ).map((rows) => {
        const r = rows[0];
        if (!r) throw new Error('profileModes.upsert: empty');
        return r;
      });
    },
    seedDefaults(userId) {
      const work = async (): Promise<void> => {
        // Reader on by default; Author and Reviewer present but off.
        const rows = PROFILE_MODES.map((mode) => ({
          userId,
          mode,
          enabled: mode === 'reader',
          public: mode === 'reader',
        }));
        await db.insert(profileModes).values(rows).onConflictDoNothing();
      };
      return fromPromise(work(), (cause) => Errors.internal('profileModes.seedDefaults', cause));
    },
  };
}
