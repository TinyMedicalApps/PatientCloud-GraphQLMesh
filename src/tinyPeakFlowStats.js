const moment = require("moment");
const fetch = require("node-fetch");

const flattenObservations = (observations) => {
  return observations.reduce((acc, obs) => {
    if (obs.component) {
      acc.concat(
        obs.component.map((comp) => {
          return { ...obs, ...comp };
        })
      );
    } else {
      acc.push(obs);
    }

    return acc;
  }, []);
};

const sumValueQuantity = (arr) => {
  return arr.reduce((sum, item) => {
    if (item.valueQuantity) {
      return sum + item.valueQuantity.value;
    } else {
      return sum;
    }
  }, 0);
};

const ObservationByPatientWithArgs = async (args) => {
  const { PatientID } = args;

  const res = await fetch(
    `https://api.logicahealth.org/PatientCloud401/open/Observation?${new URLSearchParams({
      patient: PatientID,
      _total: "accurate",
      _count: 1000,
      "code:code": "19935-6",
    })}`,
    {
      method: "GET",
      redirect: "follow",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return await res.json();
};

const resolvers = {
  // enum define a restricted, pre-defined set of values
  // https://graphql.org/learn/schema/#enumeration-types
  PeriodInterval: {
    MONTH: "month",
    WEEK: "week",
  },
  OrderDirection: {
    ASC: "asc",
    DESC: "desc",
  },
  TinyPeakFlowResponse: {
    statsForPeriod: async (parent, args, context, info) => {
      // for each grouped observation, calculate avg
      const { period, range = null } = parent.interval;
      const incomingFormat = period === "month" ? "MM_YYYY" : "WW_YYYY";

      return Object.entries(parent.grouped).map(([key, obs]) => {
        return {
          AVGMeanValue: sumValueQuantity(obs) / obs.length,
          DateLabel: moment(key, incomingFormat).format(`${period === "month" ? "MMMM YYYY" : "[Week] W YYYY"}`),
          DateNumber: moment(key, incomingFormat).format(`${period === "month" ? "DD-MM-YYYY" : "d-WW-YYYY"}`),
        };
      });
    },
    statsAllTime: async (parent, args, context, info) => {
      // for all observations, calculate avg and best value
      const bestValue = Math.max(
        ...parent.all.map((e) => {
          return e.valueQuantity.value;
        })
      );

      return {
        BestValue: bestValue,
        EIGHTYPCBestValue: bestValue * 0.8,
        AVGMeanValue: sumValueQuantity(parent.all) / parent.all.length,
      };
    },
  },
  Query: {
    TinyPeakFlowStats: async (parent, args, context, info) => {
      // interval is set "month" as default
      const { PatientID, interval, dateorder = "desc" } = args;

      const { period, range = null } = interval;

      const res = await ObservationByPatientWithArgs({
        PatientID,
      });

      // const res = await context["LogicaHealth Sandbox v3"].api.ObservationByPatient({
      //   PatientID,
      // });

      // res is { entry: [...list of entries] }
      // for each entry, parse and return the full data object
      return Promise.all(
        res.entry.map(async (el) => {
          try {
            const singleEntry = await fetch(el.fullUrl, {
              method: "GET",
              redirect: "follow",
              headers: {
                "Content-Type": "application/json",
              },
            });

            return await singleEntry.json();
          } catch (error) {
            throw new Error(error);
          }
        })
      )
        .then((result) => {
          // flatten the observations array, because some might have multiple values on the same instance
          // then group by same month+year
          const filteredObservations = flattenObservations(result)
            // sort by given dateorder
            .sort((a, b) => {
              if (dateorder === "desc") {
                return moment(b.effectiveDateTime).diff(moment(a.effectiveDateTime));
              } else {
                return moment(a.effectiveDateTime).diff(moment(b.effectiveDateTime));
              }
            })
            // filter array if a range is given
            .filter((elem) => {
              if (range) {
                // check if current date is in the range (so in the last <range> <period>)
                return moment(elem.effectiveDateTime).isAfter(moment().subtract(range, period));
              } else {
                return true;
              }
            });

          const groupBy = filteredObservations.reduce((accumulator, observation) => {
            const formattedDate = moment(observation.effectiveDateTime).format(
              period === "month" ? "MM_YYYY`" : "WW_YYYY"
            );

            if (accumulator[formattedDate]) {
              accumulator[formattedDate].push(observation);
            } else {
              accumulator[formattedDate] = [observation];
            }

            return accumulator;
          }, {});
          // return grouped observations as well as the entire flattened list, so underlying resolvers can access these data
          return { grouped: groupBy, all: filteredObservations, interval };
        })
        .catch((error) => {
          throw new Error(error);
        });
    },
  },
};

module.exports = { resolvers };
