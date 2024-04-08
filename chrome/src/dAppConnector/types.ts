export type Paginate = {
  page: number;
  limit: number;
};
export type Bytes = string;
export type RequestAccess = () => Promise<boolean>;
