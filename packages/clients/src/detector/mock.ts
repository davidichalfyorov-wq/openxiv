import { makeHeuristicDetector } from './heuristic.js';
import type { AiDetector } from './interface.js';

export const makeMockDetector = (): AiDetector => makeHeuristicDetector();
