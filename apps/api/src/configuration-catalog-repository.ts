import type {
  EnvironmentDetailDto,
  EnvironmentSummaryDto,
  ExpertDetailDto,
  ExpertSummaryDto,
} from '@relay/contracts'

export type ConfigurationCatalogCursor = {
  updatedAt: string
  id: string
}

export type ConfigurationCatalogListOptions = {
  limit?: number
  cursor?: ConfigurationCatalogCursor
}

export type ConfigurationCatalogPage<T> = {
  items: T[]
  hasMore: boolean
  nextCursor: ConfigurationCatalogCursor | null
}

export interface ConfigurationCatalogRepository {
  listExperts(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: ConfigurationCatalogListOptions,
  ): Promise<ConfigurationCatalogPage<ExpertSummaryDto> | null>
  getExpert(
    organizationId: string,
    spaceId: string,
    expertId: string,
    actorId: string,
  ): Promise<ExpertDetailDto | null>
  listEnvironments(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: ConfigurationCatalogListOptions,
  ): Promise<ConfigurationCatalogPage<EnvironmentSummaryDto> | null>
  getEnvironment(
    organizationId: string,
    spaceId: string,
    environmentId: string,
    actorId: string,
  ): Promise<EnvironmentDetailDto | null>
}

function emptyPage<T>(): ConfigurationCatalogPage<T> {
  return { items: [], hasMore: false, nextCursor: null }
}

export class EmptyConfigurationCatalogRepository implements ConfigurationCatalogRepository {
  listExperts(
    ...arguments_: Parameters<ConfigurationCatalogRepository['listExperts']>
  ): Promise<ConfigurationCatalogPage<ExpertSummaryDto>> {
    void arguments_
    return Promise.resolve(emptyPage())
  }

  getExpert(...arguments_: Parameters<ConfigurationCatalogRepository['getExpert']>): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }

  listEnvironments(
    ...arguments_: Parameters<ConfigurationCatalogRepository['listEnvironments']>
  ): Promise<ConfigurationCatalogPage<EnvironmentSummaryDto>> {
    void arguments_
    return Promise.resolve(emptyPage())
  }

  getEnvironment(...arguments_: Parameters<ConfigurationCatalogRepository['getEnvironment']>): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }
}
