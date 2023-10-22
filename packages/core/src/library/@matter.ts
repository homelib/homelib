import type {
  Attribute,
  AttributeClient,
  Attributes,
  Cluster,
  Commands,
  Events,
} from '@project-chip/matter.js/cluster';
import type {
  BitSchema,
  TypeFromPartialBitSchema,
} from '@project-chip/matter.js/schema';

export type UnknownCluster = Cluster<
  BitSchema,
  TypeFromPartialBitSchema<BitSchema>,
  Attributes,
  Commands,
  Events
>;

export type UnknownAttribute = Attribute<unknown, BitSchema>;

export type UnknownAttributes = Record<string, UnknownAttribute>;

export type UnknownAttributeClient = AttributeClient<unknown>;

export type UnknownAttributeClients = Record<string, UnknownAttributeClient>;
