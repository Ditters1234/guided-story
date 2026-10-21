import { getRepository } from '#lib/server/repository';

export function load() {
  const repository = getRepository(); const library = repository.list();
  return { library, setups: repository.listSetups(), story: library[0] ? repository.read(library[0].id) : null, instance: process.env.STORY_INSTANCE || 'dev' };
}
