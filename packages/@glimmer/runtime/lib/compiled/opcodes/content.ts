import { Opaque } from '@glimmer/interfaces';
import { isConst, isModified, map, Reference, ReferenceCache, VersionedPathReference } from '@glimmer/reference';
import { clear, Cursor } from '../../bounds';
import { Fragment } from '../../builder';
import { isComponentDefinition } from '../../component/interfaces';
import { DOMTreeConstruction } from '../../dom/helper';
import { APPEND_OPCODES, Op, OpcodeJSON, UpdatingOpcode } from '../../opcodes';
import { ConditionalReference } from '../../references';
import Upsert, {
  cautiousInsert,
  CautiousInsertion,
  Insertion,
  isNode,
  isSafeString,
  isString,
  trustingInsert,
  TrustingInsertion,
} from '../../upsert';
import { UpdatingVM, VM } from '../../vm';

APPEND_OPCODES.add(Op.DynamicContent, (vm, { op1: append }) => {
  let opcode = vm.constants.getOther(append) as AppendDynamicOpcode<Insertion>;
  opcode.evaluate(vm);
});

function isEmpty(value: Opaque): boolean {
  return value === null || value === undefined || typeof value.toString !== 'function';
}

export function normalizeTextValue(value: Opaque): string {
  if (isEmpty(value)) {
    return '';
  }
  return String(value);
}

function normalizeTrustedValue(value: Opaque): TrustingInsertion {
  if (isEmpty(value)) {
    return '';
  }
  if (isString(value)) {
    return value;
  }
  if (isSafeString(value)) {
    return value.toHTML();
  }
  if (isNode(value)) {
    return value;
  }
  return String(value);
}

function normalizeValue(value: Opaque): CautiousInsertion {
  if (isEmpty(value)) {
    return '';
  }
  if (isString(value)) {
    return value;
  }
  if (isSafeString(value) || isNode(value)) {
    return value;
  }
  return String(value);
}

export abstract class AppendDynamicOpcode<T extends Insertion> {
  evaluate(vm: VM) {
    let reference = vm.stack.pop<VersionedPathReference<Opaque>>();

    let normalized = this.normalize(reference);

    let value: T;
    let cache: ReferenceCache<T> | undefined;

    if (isConst(reference)) {
      value = normalized.value();
    } else {
      cache = new ReferenceCache(normalized);
      value = cache.peek();
    }

    let stack = vm.elements();
    let upsert = this.insert(vm.env.getAppendOperations(), stack, value);
    let bounds = new Fragment(upsert.bounds);

    stack.newBounds(bounds);

    if (cache /* i.e. !isConst(reference) */) {
      vm.updateWith(this.updateWith(vm, reference, cache, bounds, upsert));
    }
  }

  protected abstract normalize(reference: Reference<Opaque>): Reference<T>;
  protected abstract insert(dom: DOMTreeConstruction, cursor: Cursor, value: T): Upsert;
  protected abstract updateWith(vm: VM, reference: Reference<Opaque>, cache: ReferenceCache<T>, bounds: Fragment, upsert: Upsert): UpdatingOpcode;
}

export class IsComponentDefinitionReference extends ConditionalReference {
  static create(inner: Reference<Opaque>): IsComponentDefinitionReference {
    return new IsComponentDefinitionReference(inner);
  }

  toBool(value: Opaque): boolean {
    return isComponentDefinition(value);
  }
}

abstract class UpdateOpcode<T extends Insertion> extends UpdatingOpcode {
  constructor(
    protected cache: ReferenceCache<T>,
    protected bounds: Fragment,
    protected upsert: Upsert,
  ) {
    super();
    this.tag = cache.tag;
  }

  evaluate(vm: UpdatingVM) {
    let value = this.cache.revalidate();

    if (isModified(value)) {
      let { bounds, upsert } = this;
      let { dom } = vm;

      if (!this.upsert.update(dom, value)) {
        let cursor = new Cursor(bounds.parentElement(), clear(bounds));
        upsert = this.upsert = this.insert(vm.env.getAppendOperations(), cursor, value as T);
      }

      bounds.update(upsert.bounds);
    }
  }

  toJSON(): OpcodeJSON {
    let { _guid: guid, type, cache } = this;

    return {
      details: { lastValue: JSON.stringify(cache.peek()) },
      guid,
      type,
    };
  }

  protected abstract insert(dom: DOMTreeConstruction, cursor: Cursor, value: T): Upsert;
}

export class OptimizedCautiousAppendOpcode extends AppendDynamicOpcode<CautiousInsertion> {
  type = 'optimized-cautious-append';

  protected normalize(reference: Reference<Opaque>): Reference<CautiousInsertion> {
    return map(reference, normalizeValue);
  }

  protected insert(dom: DOMTreeConstruction, cursor: Cursor, value: CautiousInsertion): Upsert {
    return cautiousInsert(dom, cursor, value);
  }

  protected updateWith(_vm: VM, _reference: Reference<Opaque>, cache: ReferenceCache<CautiousInsertion>, bounds: Fragment, upsert: Upsert): UpdatingOpcode {
    return new OptimizedCautiousUpdateOpcode(cache, bounds, upsert);
  }
}

class OptimizedCautiousUpdateOpcode extends UpdateOpcode<CautiousInsertion> {
  type = 'optimized-cautious-update';

  protected insert(dom: DOMTreeConstruction, cursor: Cursor, value: CautiousInsertion): Upsert {
    return cautiousInsert(dom, cursor, value);
  }
}

export class OptimizedTrustingAppendOpcode extends AppendDynamicOpcode<TrustingInsertion> {
  type = 'optimized-trusting-append';

  protected normalize(reference: Reference<Opaque>): Reference<TrustingInsertion> {
    return map(reference, normalizeTrustedValue);
  }

  protected insert(dom: DOMTreeConstruction, cursor: Cursor, value: TrustingInsertion): Upsert {
    return trustingInsert(dom, cursor, value);
  }

  protected updateWith(_vm: VM, _reference: Reference<Opaque>, cache: ReferenceCache<TrustingInsertion>, bounds: Fragment, upsert: Upsert): UpdatingOpcode {
    return new OptimizedTrustingUpdateOpcode(cache, bounds, upsert);
  }
}

class OptimizedTrustingUpdateOpcode extends UpdateOpcode<TrustingInsertion> {
  type = 'optimized-trusting-update';

  protected insert(dom: DOMTreeConstruction, cursor: Cursor, value: TrustingInsertion): Upsert {
    return trustingInsert(dom, cursor, value);
  }
}

export type AppendDynamicOpcodeConstructor =  typeof OptimizedCautiousAppendOpcode | typeof OptimizedTrustingAppendOpcode;
