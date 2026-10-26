import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts a handler out of the global JwtAuthGuard (spec §8). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
