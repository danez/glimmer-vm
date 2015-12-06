import { Opcode } from '../../opcodes';
import { VM } from '../../vm';
import { ComponentInvocation } from '../../component/interfaces';

export class OpenComponentOpcode extends Opcode {
  public type = "open-component";
  private invocation: ComponentInvocation;

  constructor(invocation: ComponentInvocation) {
    super();
    this.invocation = invocation;
  }

  evaluate(vm: VM) {
    vm.pushFrame(this.invocation.layout.opcodes(vm.env));
    vm.setTemplates(<any>this.invocation.templates);
  }
}