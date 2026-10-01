import { useState } from "react";
import { Modal, Input, App } from "antd";
import { useStore } from "../store/useStore";

/**
 * 新建分类弹窗（博物架 / 灵感库共用）。
 * 只负责「取名字 → 写进 store → 提示」，新分类默认追加在分类顺序的末尾，
 * 之后可以在分类行上按住拖动调整位置。
 */
export default function NewCategoryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const categories = useStore((s) => s.categories);
  const addCategory = useStore((s) => s.addCategory);
  const { message } = App.useApp();
  const [name, setName] = useState("");

  const close = () => {
    setName("");
    onClose();
  };

  const submit = () => {
    const n = name.trim();
    if (!n) {
      message.warning("请输入分类名称");
      return;
    }
    if (categories.includes(n)) {
      message.warning(`已存在分类「${n}」`);
      return;
    }
    addCategory(n);
    message.success(`已新建分类「${n}」`);
    close();
  };

  return (
    <Modal
      title="新建分类"
      open={open}
      onOk={submit}
      onCancel={close}
      okText="新建"
      cancelText="取消"
      centered
    >
      <Input
        placeholder="例如：宠物 / 健身 / 烘焙"
        value={name}
        maxLength={10}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={submit}
        autoFocus
      />
    </Modal>
  );
}
