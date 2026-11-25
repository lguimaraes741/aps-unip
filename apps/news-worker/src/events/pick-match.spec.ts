import { pickMatch } from './event-builder';

const city = { id: 'cidade', districtIbges: [] as string[] };
const lapa = { id: 'lapa', districtIbges: ['355030848'] };
const mooca = { id: 'mooca', districtIbges: ['355030853'] };

describe('pickMatch (escolha determinística do evento)', () => {
  it('matéria com distrito vai para o evento do mesmo distrito', () => {
    expect(pickMatch([city, lapa, mooca], ['355030853'])?.id).toBe('mooca');
  });
  it('matéria com distrito sem evento daquele distrito vai para o evento só da cidade', () => {
    expect(pickMatch([lapa, city], ['355030800'])?.id).toBe('cidade');
  });
  it('matéria com distrito e só eventos de OUTROS distritos: nenhum', () => {
    expect(pickMatch([lapa, mooca], ['355030800'])).toBeNull();
  });
  it('matéria só com a cidade prefere o evento só da cidade', () => {
    expect(pickMatch([lapa, city], [])?.id).toBe('cidade');
  });
  it('matéria só com a cidade e UM evento de distrito: entra como contexto', () => {
    expect(pickMatch([lapa], [])?.id).toBe('lapa');
  });
  it('matéria só com a cidade e VÁRIOS eventos de distrito: não chuta', () => {
    expect(pickMatch([lapa, mooca], [])).toBeNull();
  });
});
