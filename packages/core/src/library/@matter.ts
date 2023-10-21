import type {
  Attribute,
  AttributeClient,
  ClusterFactory,
} from '@project-chip/matter.js/cluster';
import type {BitSchema} from '@project-chip/matter.js/schema';

export type UnknownCluster =
  ClusterFactory.Definition<ClusterFactory.PartialDefinition>;

export type UnknownAttribute = Attribute<unknown, BitSchema>;

export type UnknownAttributes = Record<string, UnknownAttribute>;

export type UnknownAttributeClient = AttributeClient<unknown>;

export type UnknownAttributeClients = Record<string, UnknownAttributeClient>;
